import { proposalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

/**
 * Proposed delivery commands. Every member sees every proposal, as they see every line.
 * Accepting runs the proposed command under the accepter, so a viewer's acceptance is refused by
 * the command's own editor rule.
 */
export function proposalHandlers() {
  return handlersOf<AppState, Services>({
    store: (state) => state.proposals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible: () => true,
    newId,
    now,
  });
}
