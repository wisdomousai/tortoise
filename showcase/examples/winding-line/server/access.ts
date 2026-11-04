import { ApplicationError } from '@tortoise/contracts';
import { FRESH_MS, own, stationRole, type LineState, type Station } from '../domain';
import { byCodePoint, now, type Context } from './context';

/** The station, or NOT_FOUND; policy already checked the caller's role on it. */
export function stationOf(state: LineState, id: string): Station {
  const station = own(state.stations, id);
  if (!station) throw new ApplicationError('NOT_FOUND', 'Station unavailable');
  return station;
}
/** Stations where the caller holds a role, narrowed by a delegated grant, in id order. */
export function accessibleStations(ctx: Context): Station[] {
  return Object.values(ctx.state.stations)
    .filter(
      (station) =>
        stationRole(ctx.state, ctx.context.principalId, station.id) &&
        (!ctx.context.grant?.resources ||
          ctx.context.grant.resources.includes(`station:${station.id}`)),
    )
    .sort((a, b) => byCodePoint(a.id, b.id));
}
export const isStale = (ctx: Context, station: Station) =>
  station.observedAt === undefined || now(ctx) - station.observedAt > FRESH_MS;
/** The revision key for a station's good and scrap counters. */
export const counters = (station: string) => `counters:${station}`;
