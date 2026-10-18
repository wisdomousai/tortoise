import { approvalHandlers as handlersOf } from '@agent-native/runtime';
import { commandOperations } from '../contracts/commands';
import type { LineState } from '../domain';
import { stationOfResource } from '../policy';
import { accessibleStations } from '../server/access';
import { newId, now, type LineServices } from '../server/context';

/**
 * Approval requests at the station. Every approval request names the record it is about (`stop:<id>`), and the
 * policy resolves that record's station for submit, approve and reject; an approval request is visible to
 * whoever works at that station, within a delegated grant's stations. Approving runs the
 * requested command under the approver's station role.
 */
export function approvalHandlers() {
  return handlersOf<LineState, LineServices>({
    store: (state) => state.approvals,
    commands: Object.values(commandOperations),
    visible(approval, ctx) {
      const station = approval.resource && stationOfResource(ctx.state, approval.resource);
      return !!station && accessibleStations(ctx).some((item) => item.id === station);
    },
    newId,
    now,
  });
}
