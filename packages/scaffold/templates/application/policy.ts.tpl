import { definePolicy, own, type OperationRule } from '@agent-native/runtime';
import { operations } from './contracts';
import type { AppState, Role } from './domain';
// scaffold:imports

const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
/** Commands that change records: editors only. Reads are open to members, scoped in handlers. */
const editor: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Workspace policy. Only members pass the caller gate; integration principals hold no role and
 * act only in their own lanes. An operation this policy does not list is denied.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    // scaffold:lanes
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    // scaffold:rules
  },
  events: {
    // Feed and delivery state is visible to every member.
    sync: () => true,
    // scaffold:events
  },
});

// scaffold:access
