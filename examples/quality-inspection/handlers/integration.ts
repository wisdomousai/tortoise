import type { z } from 'zod';
import { completeDelivery, targetHandlers } from '@agent-native/integration';
import type { HandlerContribution } from '@agent-native/runtime';
import type { codeGroupSchema, lotSnapshotSchema } from '../contracts/schemas';
import { qualityTarget } from '../contracts/target';
import { own, put, type QualityState, type Synchronized } from '../domain';
import { accessiblePlants, lotVisible, resourceVisible } from '../server/access';
import { TARGET, compact, now, type Context, type QualityServices } from '../server/context';

type LotSnapshot = z.output<typeof lotSnapshotSchema>;
type Extra = { codeGroups?: z.output<typeof codeGroupSchema>[] };

/** The record an effect forwarded: a result, a defect or a lot's usage decision. */
function forwarded(ctx: Context, resource: string): Synchronized | undefined {
  const separator = resource.indexOf(':');
  const type = resource.slice(0, separator);
  const id = resource.slice(separator + 1);
  if (type === 'result') return own(ctx.state.results, id);
  if (type === 'defect') return own(ctx.state.defects, id);
  return type === 'lot' ? own(ctx.state.lots, id)?.decision : undefined;
}

/** Apply one lot snapshot, keeping the local status and usage decision. */
function applyLot(ctx: Context, snapshot: LotSnapshot) {
  if (!own(ctx.state.plants, snapshot.plant))
    // New plants start without members; access is granted explicitly, never inferred.
    put(ctx.state.plants, snapshot.plant, { members: {} });
  const existing = own(ctx.state.lots, snapshot.id);
  const { closed, ...master } = snapshot;
  const status = existing?.status ?? 'open';
  put(
    ctx.state.lots,
    snapshot.id,
    compact({
      ...master,
      status: closed && status === 'open' ? ('closed' as const) : status,
      decision: existing?.decision,
    }),
  );
  ctx.change(`lot:${snapshot.id}`);
}

/** Counts by sync state over visible records; a superseded rejection counts as resolved. */
function syncStatus(ctx: Context) {
  const plants = accessiblePlants(ctx);
  const records: { resource: string; lotId: string; record: Synchronized; active: boolean }[] = [
    ...Object.values(ctx.state.results).map((result) => ({
      resource: `result:${result.id}`,
      lotId: result.lotId,
      record: result as Synchronized,
      active: result.supersededBy === undefined,
    })),
    ...Object.values(ctx.state.defects).map((defect) => ({
      resource: `defect:${defect.id}`,
      lotId: defect.lotId,
      record: defect as Synchronized,
      active: true,
    })),
    ...Object.values(ctx.state.lots).flatMap((lot) =>
      lot.decision
        ? [{ resource: `lot:${lot.id}`, lotId: lot.id, record: lot.decision, active: true }]
        : [],
    ),
  ].filter((entry) => lotVisible(ctx, plants, entry.lotId));
  const pendingEffects = ctx
    .effects({ status: 'pending', target: TARGET })
    .filter((effect) => resourceVisible(ctx, plants, effect.resource));
  const count = (status: Synchronized['sync']) =>
    records.filter((entry) => entry.record.sync === status).length;
  return compact({
    pending: count('pending'),
    accepted: count('accepted'),
    rejected: count('rejected'),
    retrying: pendingEffects.filter((effect) => effect.attempts > 0).length,
    oldestPendingAt: pendingEffects[0]?.createdAt,
    // A superseded rejection was resolved by its correction.
    rejections: records
      .filter((entry) => entry.active && entry.record.sync === 'rejected')
      .slice(0, 50)
      .map((entry) => ({
        resource: entry.resource,
        lotId: entry.lotId,
        code: entry.record.rejection?.code ?? 'REJECTED',
        message: entry.record.rejection?.message ?? 'Rejected by the quality system',
      })),
  });
}

/**
 * Inbound lot sync, outbound completion and synchronization status. Only the forwarded record
 * changes on completion, so a completion never invalidates a supervisor's review.
 */
export const integrationHandlers = (): HandlerContribution<QualityState, QualityServices>[] =>
  targetHandlers<QualityState, QualityServices, LotSnapshot, Extra>(qualityTarget, {
    cursor: (state) => state,
    now,
    onOutcome: (effect, outcome, ctx) =>
      completeDelivery(forwarded(ctx, effect.resource), effect, outcome),
    applyBatch(batch, ctx) {
      for (const snapshot of batch.items) applyLot(ctx, snapshot);
      for (const group of batch.codeGroups ?? []) put(ctx.state.codeGroups, group.id, group);
      return batch.items.length;
    },
    status: syncStatus,
  });
