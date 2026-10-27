import { type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { percentile, type QualityState } from '../domain';
import { accessiblePlants, lotVisible, resourceVisible } from '../server/access';
import { TARGET, compact, handler, type QualityServices } from '../server/context';

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

/** Capture metrics, aggregated only over lots the caller may see. */
export const reportHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  metricsSummaryHandler(),
];
