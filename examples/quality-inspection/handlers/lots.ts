import { type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { activeResults, plantRole, progress, type QualityState } from '../domain';
import { accessiblePlants, grantAllowsLot } from '../server/access';
import { byCodePoint, compact, lotOf, handler, type QualityServices } from '../server/context';
import { withoutEffect, resultDto, defectDto, lotSummary } from '../server/dto';

/** Lots, the worklist, code groups and plants, each read through the caller's plant roles. */
export const lotHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  handler(operations.lotList, (input, ctx) => {
    const plants = accessiblePlants(ctx);
    const search = input.search?.toLowerCase();
    const items = Object.values(ctx.state.lots)
      .filter(
        (lot) =>
          plants.has(lot.plant) &&
          grantAllowsLot(ctx, lot.id) &&
          (input.plant === undefined || lot.plant === input.plant) &&
          (input.status === undefined || lot.status === input.status) &&
          (search === undefined ||
            `${lot.id} ${lot.material} ${lot.materialText} ${lot.batch ?? ''}`
              .toLowerCase()
              .includes(search)),
      )
      .sort(
        (a, b) =>
          Number(a.status !== 'open') - Number(b.status !== 'open') || byCodePoint(a.id, b.id),
      );
    const offset = input.offset ?? 0;
    return {
      count: items.length,
      items: items.slice(offset, offset + (input.limit ?? 50)).map((lot) => lotSummary(ctx, lot)),
    };
  }),
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
