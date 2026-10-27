import { own, plantRole } from '../domain';
import { lotOfResource } from '../policy';
import type { Context } from './context';

export function accessiblePlants(ctx: Context): Set<string> {
  return new Set(
    Object.keys(ctx.state.plants).filter((plant) =>
      plantRole(ctx.state, ctx.context.principalId, plant),
    ),
  );
}
/** Resource-limited delegations name lots; list queries honor them before counting. */
export function grantAllowsLot(ctx: Context, lotId: string): boolean {
  return !ctx.context.grant?.resources || ctx.context.grant.resources.includes(`lot:${lotId}`);
}
/**
 * Whether the caller may see data owned by `lotId`: its plant is one the caller holds a role at,
 * matches the optional plant filter, and a resource-limited delegation names the lot. Rows,
 * counts, timings and effect aggregates all pass through this before anything is aggregated.
 */
export function lotVisible(
  ctx: Context,
  plants: ReadonlySet<string>,
  lotId: string,
  plant?: string,
) {
  const owner = own(ctx.state.lots, lotId)?.plant;
  return (
    owner !== undefined &&
    plants.has(owner) &&
    (plant === undefined || owner === plant) &&
    grantAllowsLot(ctx, lotId)
  );
}
/** Visibility of a journal or outbox resource, through the lot that owns it. */
export function resourceVisible(
  ctx: Context,
  plants: ReadonlySet<string>,
  resource: string,
  plant?: string,
) {
  const lotId = lotOfResource(ctx.state, resource);
  return lotId !== undefined && lotVisible(ctx, plants, lotId, plant);
}
