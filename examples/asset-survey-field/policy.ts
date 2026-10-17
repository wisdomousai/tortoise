import { targetRules } from '@agent-native/integration';
import { definePolicy } from '@agent-native/runtime';
import { fieldOperations as ops, hubTarget } from './contracts';
import type { FieldState } from './domain';

/**
 * The device has one person, its owner. The integration principal delivers to the hub and
 * applies its feed and nothing else. The hub decides again on every record it receives, as the
 * device's own principal, so nothing here widens what the device may do there.
 */
export const fieldPolicy = definePolicy<FieldState, 'owner'>({
  roleOf: (state, principalId) => (principalId === state.ownerId ? 'owner' : undefined),
  integrations: [
    {
      is: (state, principalId) => principalId === state.integrationPrincipalId,
      operations: hubTarget.integrationOperations,
    },
  ],
  caller: { allow: (state, context) => context.principalId === state.ownerId },
  operations: {
    ...targetRules(hubTarget),
    [ops.assignmentList.id]: 'open',
    [ops.nodeList.id]: 'open',
    [ops.captureRecord.id]: 'open',
    [ops.captureList.id]: 'open',
    [ops.assignmentReturn.id]: 'open',
  },
  events: Object.fromEntries(
    ['assignment', 'capture', 'sync'].map((type) => [
      type,
      (_id: string, state: FieldState, context: { principalId: string }) =>
        context.principalId === state.ownerId,
    ]),
  ),
});
