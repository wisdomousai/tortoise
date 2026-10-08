import { type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { percentile, type QualityState, type Synchronized } from '../domain';
import { accessiblePlants, lotVisible, resourceVisible } from '../server/access';
import { TARGET, compact, handler, type QualityServices } from '../server/context';

/** Counts by sync state over visible records; a superseded rejection counts as resolved. */
const syncStatusHandler = () =>
  handler(operations.syncStatus, (_, ctx) => {
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
      watermark: ctx.state.watermark,
      lastSyncAt: ctx.state.lastSyncAt,
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
  });

/** Capture timing per actor, corrections and forwarding latency, within the caller's scope. */
const metricsSummaryHandler = () =>
  handler(operations.metricsSummary, (input, ctx) => {
    const plants = accessiblePlants(ctx);
    const since = input.since ?? 0;
    const inScope = (lotId: string) => lotVisible(ctx, plants, lotId, input.plant);
    const results = Object.values(ctx.state.results).filter(
      (result) => result.recordedAt >= since && inScope(result.lotId),
    );
    const captures = results.filter((result) => result.supersedes === undefined);
    const timing = (actor: 'human' | 'agent') => {
      const samples = captures
        .filter((result) => result.capture.actor === actor)
        .flatMap((result) =>
          result.capture.durationMs === undefined ? [] : [result.capture.durationMs],
        );
      return compact({
        count: captures.filter((result) => result.capture.actor === actor).length,
        medianMs: percentile(samples, 0.5),
        p90Ms: percentile(samples, 0.9),
      });
    };
    const effects = ctx
      .effects({ target: TARGET })
      .filter(
        (effect) =>
          effect.createdAt >= since && resourceVisible(ctx, plants, effect.resource, input.plant),
      );
    const acceptance = effects.flatMap((effect) =>
      effect.status === 'accepted' && effect.settledAt !== undefined
        ? [effect.settledAt - effect.createdAt]
        : [],
    );
    return {
      datapoints: captures.length,
      human: timing('human'),
      agent: timing('agent'),
      corrections: results.length - captures.length,
      outOfTolerance: results.filter(
        (result) => result.supersededBy === undefined && result.evaluation === 'rejected',
      ).length,
      forwarding: {
        pending: effects.filter((effect) => effect.status === 'pending').length,
        rejected: effects.filter((effect) => effect.status === 'rejected').length,
        accepted: compact({
          count: acceptance.length,
          medianMs: percentile(acceptance, 0.5),
          p90Ms: percentile(acceptance, 0.9),
        }),
      },
    };
  });

/** Synchronization and capture metrics, aggregated only over lots the caller may see. */
export const reportHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  syncStatusHandler(),
  metricsSummaryHandler(),
];
