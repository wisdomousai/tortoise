import { definePolicy } from '@tortoise/runtime';
import { worklistRules } from '@tortoise/assignments/server';
import { fieldOperations, worklist } from './contracts';
import type { FieldState } from './domain';

const owns = (state: FieldState, context: { principalId: string }) =>
  context.principalId === state.localUserId;

/**
 * The device has one person, its local user. The integration principal delivers to the hub and
 * applies its inbound sync and nothing else. The hub decides again on every capture it receives, as the
 * device's own principal, so nothing here widens what the device may do there.
 */
export const fieldPolicy = definePolicy<FieldState, 'local-user'>({
  roleOf: (state, principalId) => (principalId === state.localUserId ? 'local-user' : undefined),
  integrations: [
    {
      is: (state, principalId) => principalId === state.integrationPrincipalId,
      operations: worklist.target.integrationOperations,
    },
  ],
  caller: { allow: owns },
  operations: {
    ...worklistRules(worklist),
    [fieldOperations.tagGet.id]: 'open',
    // The notification dispatcher: the local user under its delegated grant, never a screen.
    [fieldOperations.noticesComplete.id]: {
      allow: ({ state, context }) =>
        state.localUserId === context.principalId && context.grant !== undefined,
    },
  },
  events: {
    [worklist.types.assignment]: (_id, state, context) => owns(state, context),
    [worklist.types.report]: (_id, state, context) => owns(state, context),
    sync: (_id, state, context) => owns(state, context),
  },
});
