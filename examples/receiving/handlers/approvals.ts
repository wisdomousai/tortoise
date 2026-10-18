import { approvalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

/**
 * Requested delivery commands. Every member sees every approval request, as they see every line.
 * Approving runs the requested command under the approver, so a viewer's approval is refused by
 * the command's own editor rule.
 */
export function approvalHandlers() {
  return handlersOf<AppState, Services>({
    store: (state) => state.approvals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible: () => true,
    newId,
    now,
  });
}
