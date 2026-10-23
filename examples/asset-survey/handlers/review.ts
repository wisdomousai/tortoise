import type { z } from 'zod';
import { ApplicationError } from '@agent-native/contracts';
import { targetHandlers } from '@agent-native/integration';
import { own, type HandlerContribution } from '@agent-native/runtime';
import {
  ATTENTION_BELOW,
  extractionOperations as ops,
  modelTarget,
  type proposalSchema,
} from '../contracts/extraction';
import { fieldOperations } from '../contracts/captures';
import type { SurveyState } from '../domain';
import {
  captureRecords,
  compact,
  conflict,
  extractionRecords,
  handler,
  nodeDto,
  nodeRecords,
  now,
  type Context,
  type SurveyServices,
} from './context';

function extractionDto(ctx: Context, captureId: string) {
  const extraction = extractionRecords(ctx).getExisting(captureId);
  const { effectId: _effect, ...visible } = extraction;
  return compact({
    ...visible,
    fields: extraction.fields.map((field) => ({
      ...field,
      attention: field.confidence < ATTENTION_BELOW,
    })),
  });
}

/**
 * Extraction: a request goes to the model through the outbox with the capture's photos, the
 * proposal returns through the model's feed, and a reviewer accepts it onto the node. The model
 * never writes attributes; only `extraction.accept`, run by a person, does.
 */
export const reviewHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  // Both calls run in this command's transaction, each with its own authorization.
  handler(ops.placeAndExtract, async (input, ctx) => {
    const capture = await ctx.invoke(fieldOperations.capturePlace, input);
    const extraction = await ctx.invoke(ops.request, { captureId: input.id });
    return { capture, extraction };
  }),
  handler(ops.request, (input, ctx) => {
    const capture = captureRecords(ctx).getExisting(input.captureId);
    if (capture.review !== 'new') conflict(`Capture is ${capture.review}`);
    const extractions = extractionRecords(ctx);
    const resource = extractions.resource(capture.id);
    // The photos become readable through the request, so the connector can send them.
    for (const photo of capture.photos) ctx.attach(resource, photo);
    const effectId = ctx.enqueue({
      target: modelTarget.target,
      type: 'extract',
      resource,
      payload: {
        captureId: capture.id,
        kind: capture.kind,
        photos: capture.photos.map((photo) => ({ ...photo })),
      },
    });
    extractions.set(
      capture.id,
      { captureId: capture.id, effectId, status: 'requested', fields: [] },
      'requested',
    );
    return extractionDto(ctx, capture.id);
  }),
  handler(ops.accept, (input, ctx) => {
    const capture = captureRecords(ctx).getExisting(input.captureId);
    if (capture.review !== 'new') conflict(`Capture is ${capture.review}`);
    if (!capture.nodeId) conflict('Place the capture on a node first');
    const extraction = own(ctx.state.extractions, capture.id);
    if (extraction?.status !== 'proposed')
      conflict(extraction ? `Extraction is ${extraction.status}` : 'No proposal to accept');
    const nodes = nodeRecords(ctx);
    const node = nodes.getExisting(capture.nodeId);
    if (node.retired) conflict('Node is retired');
    const proposed = new Map(extraction.fields.map((field) => [field.name, field.value]));
    nodes.update(
      node.id,
      (record) => {
        for (const [name, value] of Object.entries(input.values))
          record.attributes[name] = {
            value,
            captureId: capture.id,
            edited: proposed.get(name) !== value,
          };
      },
      'attributes',
    );
    extractionRecords(ctx).update(
      capture.id,
      { status: 'accepted', accepted: input.values, acceptedBy: ctx.context.principalId },
      'accepted',
    );
    captureRecords(ctx).update(capture.id, { review: 'reviewed' }, 'reviewed');
    return nodeDto(node);
  }),
  ...targetHandlers<SurveyState, SurveyServices, z.output<typeof proposalSchema>>(modelTarget, {
    cursor: (state) => state.cursors.model,
    now,
    onOutcome(effect, outcome, ctx) {
      const captureId = effect.resource.slice('extraction:'.length);
      const extraction = own(ctx.state.extractions, captureId);
      if (!extraction || extraction.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Extraction request unavailable');
      // Accepted only means the model took the request; the proposal follows through the feed.
      if (outcome.status === 'rejected')
        extractionRecords(ctx).update(
          captureId,
          { status: 'failed', rejection: { code: outcome.code, message: outcome.message } },
          'failed',
        );
      else extractionRecords(ctx).touch(captureId);
    },
    applyBatch({ items }, ctx) {
      let applied = 0;
      for (const proposal of items) {
        const extraction = own(ctx.state.extractions, proposal.captureId);
        // A proposal for a superseded request, or after acceptance, changes nothing.
        if (
          !extraction ||
          extraction.effectId !== proposal.effectId ||
          extraction.status === 'accepted'
        )
          continue;
        extractionRecords(ctx).update(
          proposal.captureId,
          { status: 'proposed', model: proposal.model, fields: proposal.fields },
          'proposed',
        );
        applied++;
      }
      return applied;
    },
    status(ctx) {
      const all = Object.values(ctx.state.extractions);
      const proposed = all.filter((extraction) => extraction.status === 'proposed');
      return {
        requested: all.filter((extraction) => extraction.status === 'requested').length,
        proposed: proposed.length,
        attention: proposed.filter((extraction) =>
          extraction.fields.some((field) => field.confidence < ATTENTION_BELOW),
        ).length,
      };
    },
  }),
];
