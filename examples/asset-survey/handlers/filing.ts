import { z } from 'zod';
import type { BlobRef } from '@agent-native/contracts';
import { implementDataProvider, settleDelivery, targetHandlers } from '@agent-native/integration';
import { own, type HandlerContribution } from '@agent-native/runtime';
import { eamAssets, eamTarget, filingOperations as ops } from '../contracts/filing';
import type { assetSnapshotSchema } from '../contracts/schemas';
import type { SurveyState } from '../domain';
import {
  compact,
  conflict,
  filingRecords,
  handler,
  newId,
  nodeRecords,
  now,
  type Context,
  type SurveyServices,
} from './context';

/** What the EAM port returns for a search, mapped from the EAM's field names. Parsed: a
 * malformed record from outside this application's trust is dropped. */
const assetRecord = z.object({
  externalId: z.string(),
  designation: z.string(),
  name: z.string(),
  manufacturer: z.string().optional(),
  serial: z.string().optional(),
});

function filingDto(ctx: Context, id: string) {
  const { effectId: _effect, ...visible } = filingRecords(ctx).getExisting(id);
  return visible;
}

/**
 * Filing into the EAM: the node's accepted attributes and the photos they were read from go out
 * through the outbox; the EAM's outcome names the asset, and its feed reports assets filed.
 */
export const filingHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  ...implementDataProvider<SurveyState, SurveyServices, typeof eamAssets>(eamAssets, {
    item(found, ctx) {
      const record = assetRecord.safeParse(found);
      if (!record.success) return undefined;
      const node = Object.values(ctx.state.nodes).find(
        (candidate) => candidate.assetId === record.data.externalId,
      );
      return compact({ ...record.data, nodeId: node?.id });
    },
  }),
  handler(ops.file, (input, ctx) => {
    const node = nodeRecords(ctx).getExisting(input.nodeId);
    if (node.retired || node.source === 'proposed') conflict('Node is not active');
    const attributes = Object.entries(node.attributes);
    if (!attributes.length) conflict('Node has no accepted attributes');
    const filings = filingRecords(ctx);
    if (filings.values().some((filing) => filing.nodeId === node.id && filing.sync === 'pending'))
      conflict('A filing for this node is pending');
    const id = newId(ctx);
    const resource = filings.resource(id);
    // Evidence: the photos of every capture an attribute was read from.
    const photos: BlobRef[] = [];
    for (const captureId of new Set(attributes.map(([, attribute]) => attribute.captureId)))
      for (const photo of (captureId && own(ctx.state.captures, captureId)?.photos) || []) {
        ctx.attach(resource, photo);
        photos.push(photo);
      }
    const assetId = input.assetId ?? node.assetId;
    const effectId = ctx.enqueue({
      target: eamTarget.target,
      type: assetId ? 'asset.update' : 'asset.create',
      resource,
      payload: {
        ...(assetId ? { assetId } : {}),
        designation: node.designation,
        scheme: node.scheme,
        name: node.name,
        attributes: Object.fromEntries(
          attributes.map(([name, attribute]) => [name, attribute.value]),
        ),
        photos: photos.map((photo) => ({ ...photo })),
      },
    });
    filings.insert(
      id,
      compact({
        id,
        nodeId: node.id,
        designation: node.designation,
        assetId,
        effectId,
        sync: 'pending' as const,
        filedBy: ctx.context.principalId,
        filedAt: now(ctx),
      }),
      'filed',
    );
    nodeRecords(ctx).touch(node.id);
    return filingDto(ctx, id);
  }),
  handler(ops.list, (input, ctx) => ({
    items: filingRecords(ctx)
      .values()
      .filter((filing) => input.nodeId === undefined || filing.nodeId === input.nodeId)
      .sort((a, b) => b.filedAt - a.filedAt)
      .map((filing) => filingDto(ctx, filing.id)),
  })),
  ...targetHandlers<SurveyState, SurveyServices, z.output<typeof assetSnapshotSchema>>(eamTarget, {
    cursor: (state) => state.cursors.eam,
    now,
    onOutcome(effect, outcome, ctx) {
      const id = effect.resource.slice('filing:'.length);
      const filing = filingRecords(ctx).get(id);
      settleDelivery(filing, effect, outcome);
      filingRecords(ctx).touch(id);
      // The EAM names the asset it created or updated; the node remembers it for later filings.
      if (filing && outcome.status === 'accepted' && outcome.externalRef)
        nodeRecords(ctx).update(filing.nodeId, { assetId: outcome.externalRef }, 'filed');
    },
    applyBatch({ items }, ctx) {
      let applied = 0;
      for (const asset of items) {
        // Only nodes filed as this asset follow the feed; other EAM assets are not ours.
        for (const node of Object.values(ctx.state.nodes))
          if (node.assetId === asset.externalId && node.assetStatus !== asset.status) {
            nodeRecords(ctx).update(node.id, { assetStatus: asset.status }, 'asset-status');
            applied++;
          }
      }
      return applied;
    },
    status(ctx) {
      const count = (sync: string) =>
        Object.values(ctx.state.filings).filter((filing) => filing.sync === sync).length;
      return {
        pending: count('pending'),
        accepted: count('accepted'),
        rejected: count('rejected'),
      };
    },
  }),
];
