import { membershipHandler, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { stationMembership } from '../contracts/membership';
import { bridgeStation, own, type LineState } from '../domain';
import { stationOf } from '../server/access';
import { now, handler, type LineServices } from '../server/context';

/** Bridge mode, the control holder and station roles. */
export function administrationHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.bridgeSetMode, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.mode = input.mode;
      ctx.change(`station:${station.id}`);
      return { station: station.id, mode: station.mode };
    }),
    handler(operations.controlRequest, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.controlHolder = input.holder;
      station.controlChangedBy = ctx.context.principalId;
      station.controlChangedAt = now(ctx);
      ctx.change(`station:${station.id}`);
      return { station: station.id, holder: station.controlHolder };
    }),
    // Integration principals act through their own integration allowlists, never through roles.
    membershipHandler<LineState, LineServices, typeof stationMembership>(stationMembership, {
      members: (state, station) => own(state.stations, station)?.members,
      reserved: (state, principalId) =>
        principalId === state.mesPrincipalId || bridgeStation(state, principalId) !== undefined,
    }),
  ];
}
