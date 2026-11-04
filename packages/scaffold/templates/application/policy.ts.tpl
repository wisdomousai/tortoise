import { definePolicy, own, type OperationRule } from '@tortoise/runtime';
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
 * call only the operations their integration allowlist lists. An operation this policy does not list is denied.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    // scaffold:integrations
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    // scaffold:rules
  },
  events: {
    // Inbound sync and delivery state is visible to every member.
    sync: () => true,
    // scaffold:events
  },
});

// scaffold:access
