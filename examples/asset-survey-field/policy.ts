import { definePolicy } from '@agent-native/runtime';
import { worklistRules } from '@agent-native/assignments/server';
import { worklist } from './contracts';
import type { FieldState } from './domain';

const owns = (state: FieldState, context: { principalId: string }) =>
  context.principalId === state.ownerId;

/**
 * The device has one person, its owner. The integration principal delivers to the hub and
 * applies its feed and nothing else. The hub decides again on every capture it receives, as the
 * device's own principal, so nothing here widens what the device may do there.
 */
export const fieldPolicy = definePolicy<FieldState, 'owner'>({
  roleOf: (state, principalId) => (principalId === state.ownerId ? 'owner' : undefined),
  integrations: [
    {
      is: (state, principalId) => principalId === state.integrationPrincipalId,
      operations: worklist.target.integrationOperations,
    },
  ],
  caller: { allow: owns },
  operations: worklistRules(worklist),
  events: {
    [worklist.types.assignment]: (_id, state, context) => owns(state, context),
    [worklist.types.report]: (_id, state, context) => owns(state, context),
    sync: (_id, state, context) => owns(state, context),
  },
});
