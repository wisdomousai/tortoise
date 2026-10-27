import { z } from 'zod';
import type { BlobRef } from '@agent-native/contracts';
import { implementDataProvider, settleDelivery, targetHandlers } from '@agent-native/integration';
import { own, type HandlerContribution } from '@agent-native/runtime';
import { workflowOperations } from '@agent-native/workflows/contracts';
import { eamAssets, eamTarget, exportTarget, filingOperations as ops } from '../contracts/filing';
import { captureFileWorkflow, captureToEam } from '../contracts/workflow';
import type { assetSnapshotSchema } from '../contracts/schemas';
import { captureBody, captureOf, type Filing, type SurveyState } from '../domain';
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
 * File one node to a target: its accepted attributes and the photos they were read from go out
 * through the outbox. The EAM creates or updates an asset; the export directory receives a
 * folder. Each target has at most one pending filing per node; the two are independent.
 */
function fileNode(ctx: Context, nodeId: string, target: Filing['target'], asset?: string) {
  const node = nodeRecords(ctx).getExisting(nodeId);
  if (node.retired) conflict('Node is not active');
  const attributes = Object.entries(node.attributes);
  if (!attributes.length) conflict('Node has no accepted attributes');
  const filings = filingRecords(ctx);
  if (
    filings
      .values()
      .some(
        (filing) =>
          filing.nodeId === node.id && filing.target === target && filing.sync === 'pending',
      )
  )
    conflict(`A filing for this node to ${target === 'eam' ? 'the EAM' : 'the export'} is pending`);
  const id = newId(ctx);
  const resource = filings.resource(id);
  // Evidence: the photos of every capture an attribute was read from.
  const photos: BlobRef[] = [];
  for (const captureId of new Set(attributes.map(([, attribute]) => attribute.captureId))) {
    const capture = captureId === undefined ? undefined : captureOf(ctx.state, captureId);
    for (const photo of capture ? captureBody(capture).photos : []) {
      ctx.attach(resource, photo);
      photos.push(photo);
    }
  }
  const assetId = target === 'eam' ? (asset ?? node.assetId) : undefined;
  const filedAt = now(ctx);
  const record = {
    designation: node.designation,
    scheme: node.scheme,
    name: node.name,
    attributes: Object.fromEntries(attributes.map(([name, attribute]) => [name, attribute.value])),
    photos: photos.map((photo) => ({ ...photo })),
  };
  const effectId = ctx.enqueue(
    target === 'eam'
      ? {
          target: eamTarget.target,
          type: assetId ? 'asset.update' : 'asset.create',
          resource,
          payload: { ...(assetId ? { assetId } : {}), ...record },
        }
      : {
          target: exportTarget.target,
          type: 'filing.export',
          resource,
          // The folder records who filed it and when, for the system that imports it.
          payload: { ...record, filedBy: ctx.context.principalId, filedAt },
        },
  );
  filings.insert(
    id,
    compact({
      id,
      nodeId: node.id,
      designation: node.designation,
      target,
      assetId,
      effectId,
      sync: 'pending' as const,
      filedBy: ctx.context.principalId,
      filedAt,
    }),
    'filed',
  );
  nodeRecords(ctx).touch(node.id);
  return filingDto(ctx, id);
}

/**
 * Undo an accepted EAM filing through the outbox: the EAM retires the asset the filing created,
 * or restores what it replaced on the asset it updated. The withdrawal is a filing of its own;
 * withdrawing twice returns it, and a rejected filing changed nothing in the EAM.
 */
function withdraw(ctx: Context, id: string) {
  const filings = filingRecords(ctx);
  const filing = filings.getExisting(id);
  if (filing.target !== 'eam' || filing.withdraws) conflict('Only an EAM filing is withdrawn');
  if (filing.withdrawnBy) return filingDto(ctx, filing.withdrawnBy);
  if (filing.sync === 'pending') conflict('The EAM has not answered this filing yet');
  if (filing.sync === 'rejected') return filingDto(ctx, id);
  const withdrawal = newId(ctx);
  const resource = filings.resource(withdrawal);
  const effectId = ctx.enqueue({
    target: eamTarget.target,
    type: 'asset.withdraw',
    resource,
    payload: { assetId: filing.sorRef!, revert: filing.effectId, created: !filing.assetId },
  });
  filings.insert(
    withdrawal,
    {
      id: withdrawal,
      nodeId: filing.nodeId,
      designation: filing.designation,
      target: 'eam',
      assetId: filing.sorRef!,
      withdraws: filing.id,
      effectId,
      sync: 'pending',
      filedBy: ctx.context.principalId,
      filedAt: now(ctx),
    },
    'filed',
  );
  filings.update(filing.id, { withdrawnBy: withdrawal }, 'withdrawn');
  return filingDto(ctx, withdrawal);
}

/** Record a target's outcome on the filing it delivered. */
function settleFiling(
  ctx: Context,
  effect: Parameters<typeof settleDelivery>[1],
  outcome: Parameters<typeof settleDelivery>[2],
) {
  const id = effect.resource.slice('filing:'.length);
  const filing = filingRecords(ctx).get(id);
  settleDelivery(filing, effect, outcome);
  filingRecords(ctx).touch(id);
  return filing;
}

function filingCounts(ctx: Context, target: Filing['target']) {
  const count = (sync: string) =>
    Object.values(ctx.state.filings).filter(
      (filing) => filing.target === target && filing.sync === sync,
    ).length;
  return { pending: count('pending'), accepted: count('accepted'), rejected: count('rejected') };
}

/**
 * Filing into the EAM and the export directory. The EAM's outcome names the asset, and its feed
 * reports assets filed; the export's outcome names the folder written.
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
  handler(ops.file, (input, ctx) => fileNode(ctx, input.nodeId, 'eam', input.assetId)),
  handler(ops.export, (input, ctx) => fileNode(ctx, input.nodeId, 'export')),
  handler(ops.withdraw, (input, ctx) => withdraw(ctx, input.id)),
  // The capture is the business key: one instance per capture runs at a time.
  handler(captureFileWorkflow, (input, ctx) =>
    ctx.invoke(workflowOperations.start, {
      workflow: captureToEam.id,
      input: { captureId: input.id, nodeId: input.nodeId },
      key: input.id,
    }),
  ),
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
      const filing = settleFiling(ctx, effect, outcome);
      if (filing?.withdraws) {
        // A withdrawn create leaves the node without an asset, so the next filing creates one.
        const created = !own(ctx.state.filings, filing.withdraws)?.assetId;
        if (outcome.status === 'accepted' && created)
          nodeRecords(ctx).update(filing.nodeId, (node) => void delete node.assetId, 'filed');
        return;
      }
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
    status: (ctx) => filingCounts(ctx, 'eam'),
  }),
  ...targetHandlers<SurveyState, SurveyServices>(exportTarget, {
    // No feed: the written folder is the whole outcome.
    cursor: () => ({}),
    now,
    onOutcome: (effect, outcome, ctx) => void settleFiling(ctx, effect, outcome),
    status: (ctx) => filingCounts(ctx, 'export'),
  }),
];
