import { ApplicationError, type InputOf, type OutputOf } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { bridgeStation, put, type LineState } from '../domain';
import { stationOf } from '../server/access';
import { now, handler, type Context, type LineServices } from '../server/context';

/** Grant or remove a station role; never your own, never an integration principal. */
function setMember(
  input: InputOf<typeof operations.stationSetMember>,
  ctx: Context,
): OutputOf<typeof operations.stationSetMember> {
  const station = stationOf(ctx.state, input.station);
  if (input.principalId === ctx.context.principalId)
    throw new ApplicationError('FORBIDDEN', 'You cannot change your own station role');
  // Integration principals act through their own narrow lanes, never through roles.
  if (
    input.principalId === ctx.state.mesPrincipalId ||
    bridgeStation(ctx.state, input.principalId) !== undefined
  )
    throw new ApplicationError('FORBIDDEN', 'Integration principals have no station role');
  if (input.role === null) delete station.members[input.principalId];
  else put(station.members, input.principalId, input.role);
  ctx.change(`station:${station.id}`, 'authorization.changed');
  return { station: station.id, members: { ...station.members } };
}

/** Bridge mode, the station seat and station roles. */
export function administrationHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.bridgeSetMode, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.mode = input.mode;
      ctx.change(`station:${station.id}`);
      return { station: station.id, mode: station.mode };
    }),
    handler(operations.seatRequest, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.seat = input.seat;
      station.seatChangedBy = ctx.context.principalId;
      station.seatChangedAt = now(ctx);
      ctx.change(`station:${station.id}`);
      return { station: station.id, seat: station.seat };
    }),
    handler(operations.stationSetMember, setMember),
  ];
}
