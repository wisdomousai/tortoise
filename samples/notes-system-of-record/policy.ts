import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { targetLane, targetRules } from '@agent-native/integration';
import type { Role } from '@agent-native/sample-notes/server';
import { publisherTarget, publishingModule, publishingOperations } from './contracts';
import { PUBLISHER_PRINCIPAL, type NotesPublishingRoot } from './domain';

type Rule = OperationRule<NotesPublishingRoot, Role>;
const roleOf = (state: NotesPublishingRoot, principalId: string) =>
  own(state.notes.members, principalId);
const editor: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Only members pass the caller gate. Editors publish; saying whether the publisher applied a
 * held publication also needs a person. The integration principal holds no role and acts only
 * in the target's lane: settle and sync.
 */
const publishingPolicy = definePolicy<NotesPublishingRoot, Role>({
  integrations: [
    targetLane(publisherTarget, (_state, principalId) => principalId === PUBLISHER_PRINCIPAL),
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [publishingOperations.publicationList.id]: 'open',
    [publishingOperations.publicationGet.id]: 'open',
    [publishingOperations.publicationPublish.id]: editor,
    ...targetRules(publisherTarget),
    [publishingOperations.reconciliationList.id]: 'open',
    [publishingOperations.reconciliationResolve.id]: { ...editor, person: true },
  },
  events: { publication: () => true, sync: () => true },
});

/** The route for the publishing module. It selects the whole state to read the notes members. */
export const publishingRoute: AuthorizationRoute<NotesPublishingRoot> = {
  module: publishingModule,
  resourceTypes: ['publication', 'sync'],
  select: (state) => state,
  port: publishingPolicy as AuthorizationPort<unknown>,
};
