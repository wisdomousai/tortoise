import { proposalHandlers as handlersOf } from '@agent-native/runtime';
import { commandOperations } from '../contracts/commands';
import type { LineState } from '../domain';
import { stationOfResource } from '../policy';
import { accessibleStations } from '../server/access';
import { newId, now, type LineServices } from '../server/context';

/**
 * Proposals at the station. Every proposal names the record it is about (`stop:<id>`), and the
 * policy resolves that record's station for submit, accept and reject; a proposal is visible to
 * whoever works at that station, within a delegated grant's stations. Accepting runs the
 * proposed command under the accepter's station role.
 */
export function proposalHandlers() {
  return handlersOf<LineState, LineServices>({
    store: (state) => state.proposals,
    commands: Object.values(commandOperations),
    visible(proposal, ctx) {
      const station = proposal.resource && stationOfResource(ctx.state, proposal.resource);
      return !!station && accessibleStations(ctx).some((item) => item.id === station);
    },
    newId,
    now,
  });
}
