import { collectionListHandler, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { lots } from '../contracts/collections';
import {
  activeResults,
  plantRole,
  progress,
  type InspectionLot,
  type QualityState,
} from '../domain';
import { accessiblePlants, grantAllowsLot } from '../server/access';
import { byCodePoint, compact, lotOf, handler, type QualityServices } from '../server/context';
import { withoutEffect, resultDto, defectDto, lotSummary } from '../server/dto';

/** Lots, the worklist, code groups and plants, each read through the caller's plant roles. */
export const lotHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  collectionListHandler<QualityState, QualityServices, typeof operations.lotList, InspectionLot>(
    lots,
    operations.lotList,
    {
      store: (state) => state.lots,
      // A plant role and, for a resource-limited delegation, the lot itself; before counting.
      visible: (lot, ctx) =>
        plantRole(ctx.state, ctx.context.principalId, lot.plant) !== undefined &&
        grantAllowsLot(ctx, lot.id),
      present: (lot, ctx) => lotSummary(ctx, lot),
      order: (a, b) =>
        Number(a.status !== 'open') - Number(b.status !== 'open') || byCodePoint(a.id, b.id),
      searchText: (lot) => `${lot.id} ${lot.material} ${lot.materialText} ${lot.batch ?? ''}`,
    },
  ),
  handler(operations.lotGet, (input, ctx) => {
    const lot = lotOf(ctx.state, input.id);
    const results = activeResults(ctx.state, lot.id);
    const { next } = progress(ctx.state, lot);
    return compact({
      ...lotSummary(ctx, lot),
      characteristics: lot.characteristics.map((characteristic) => ({
        ...characteristic,
        results: results
          .filter((result) => result.characteristicId === characteristic.id)
          .sort((a, b) => a.sample - b.sample)
          .map((result) => resultDto(ctx, result)),
      })),
      defects: Object.values(ctx.state.defects)
        .filter((defect) => defect.lotId === lot.id)
        .sort((a, b) => a.recordedAt - b.recordedAt || byCodePoint(a.id, b.id))
        .map((defect) => defectDto(ctx, defect)),
      decision: lot.decision ? withoutEffect(lot.decision) : undefined,
      next,
    });
  }),
  handler(operations.worklist, (input, ctx) => {
    const lot = lotOf(ctx.state, input.lotId);
    const { next, recorded, required } = progress(ctx.state, lot);
    return { lotId: lot.id, next, remaining: lot.status === 'open' ? required - recorded : 0 };
  }),
  handler(operations.codeList, (_, ctx) => ({
    groups: accessiblePlants(ctx).size
      ? Object.values(ctx.state.codeGroups).sort((a, b) => byCodePoint(a.id, b.id))
      : [],
  })),
  handler(operations.plantList, (_, ctx) => ({
    items: [...accessiblePlants(ctx)].sort().map((plant) => {
      const role = plantRole(ctx.state, ctx.context.principalId, plant)!;
      return role === 'supervisor'
        ? { plant, role, members: { ...ctx.state.plants[plant]!.members } }
        : { plant, role };
    }),
  })),
];
