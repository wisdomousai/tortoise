import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { targetLane, targetRules } from '@agent-native/integration';
import type { Role } from '@agent-native/pattern-lab-requests/server';
import { limsTarget, publishingModule, publishingOperations } from './contracts';
import { LIMS_PRINCIPAL, type LabPublishingRoot } from './domain';

type Rule = OperationRule<LabPublishingRoot, Role>;
const roleOf = (state: LabPublishingRoot, principalId: string) =>
  own(state.labRequests.members, principalId);
const technician: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Only members pass the caller gate. Technicians publish; saying whether the LIMS registered a
 * held publication also needs a person. The integration principal holds no role and acts only
 * in the target's lane: settle and sync.
 */
const publishingPolicy = definePolicy<LabPublishingRoot, Role>({
  integrations: [targetLane(limsTarget, (_state, principalId) => principalId === LIMS_PRINCIPAL)],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [publishingOperations.publicationList.id]: 'open',
    [publishingOperations.publicationGet.id]: 'open',
    [publishingOperations.publicationPublish.id]: technician,
    ...targetRules(limsTarget),
    [publishingOperations.reconciliationList.id]: 'open',
    [publishingOperations.reconciliationResolve.id]: { ...technician, person: true },
  },
  events: { publication: () => true, sync: () => true },
});

/** The route for the publishing module. It selects the whole state to read the lab's members. */
export const publishingRoute: AuthorizationRoute<LabPublishingRoot> = {
  module: publishingModule,
  resourceTypes: ['publication', 'sync'],
  select: (state) => state,
  port: publishingPolicy as AuthorizationPort<unknown>,
};
