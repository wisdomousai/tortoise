import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import type { Role } from '@agent-native/pattern-base/server';
import { chamberModule, chamberOperations } from './contracts';
import { OBSERVER_PRINCIPAL, type LabSignalsRoot } from './domain';

const roleOf = (state: LabSignalsRoot, principalId: string) =>
  own(state.testRequests.members, principalId);
const technician: OperationRule<LabSignalsRoot, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};
const memberEvent = (_id: string, state: LabSignalsRoot, context: { principalId: string }) =>
  roleOf(state, context.principalId) !== undefined;

/**
 * Only members pass the caller gate: they read chambers, and technicians place samples. The
 * chamber observer is an integration principal whose lane holds the ingest command alone, so it
 * reads no chamber, request or event.
 */
const chamberPolicy = definePolicy<LabSignalsRoot, Role>({
  integrations: [
    {
      is: (_state, principalId) => principalId === OBSERVER_PRINCIPAL,
      operations: [chamberOperations.readingIngest.id],
      events: () => false,
    },
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [chamberOperations.chamberList.id]: 'open',
    [chamberOperations.chamberConditions.id]: 'open',
    [chamberOperations.chamberPlace.id]: technician,
    [chamberOperations.readingIngest.id]: 'integration',
  },
  events: { chamber: memberEvent, 'chamber-placement': memberEvent },
});

/** The route for the chamber module. It selects the whole state to read the lab's members. */
export const chamberRoute: AuthorizationRoute<LabSignalsRoot> = {
  module: chamberModule,
  resourceTypes: ['chamber', 'chamber-placement'],
  select: (state) => state,
  port: chamberPolicy as AuthorizationPort<unknown>,
};
