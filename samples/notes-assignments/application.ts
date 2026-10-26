import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import type { Harness } from '@agent-native/agents/types';
import {
  assignmentFeature,
  type AssignmentAccess,
  type AssignmentHooks,
} from '@agent-native/assignments/server';
import { createPeerLinkPlugin } from '@agent-native/peer-link/plugin';
import {
  createNotesHandlers,
  createNotesState,
  noteOperations,
  notesModule,
  notesPolicy,
  type NotesServices,
  type Role,
} from '@agent-native/sample-notes/server';
import manifest from './manifest';
import { createReviewAutomation } from './automation';
import { assignmentOperations, assignments, notesAssignmentsSurface } from './contracts';
import type { NotesAssignmentsRoot } from './domain';
import { createReviewHandlers, reviewHooks } from './handlers';
import { reviewAccess, reviewsRoute } from './policy';

export interface NotesAssignmentsOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
  /** Between trigger loop passes; the automation plugin's default when omitted. */
  automationIntervalMs?: number;
  /** What the reviewer agent runs on; the rule reviewer, which needs no model, when omitted. */
  harnesses?: readonly Harness[];
}

/**
 * The notes module unchanged, with note reviews as assignments. A review goes to a member, who
 * reports on `My reviews`; to the reviewer agent, which a trigger runs on it; or to a peer
 * application over the peer link, which takes it into its worklist. An editor accepts each
 * report into its note.
 */
export function createNotesAssignmentsApplication(options: NotesAssignmentsOptions = {}) {
  return defineApplication<NotesAssignmentsRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({ notes: createNotesState(ownerId, options.members) }),
    handlers: [
      ...sliceHandlers<NotesAssignmentsRoot, 'notes', NotesServices>(
        'notes',
        createNotesHandlers(),
      ),
      ...createReviewHandlers(),
    ],
    authorization: composeAuthorization<NotesAssignmentsRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
      reviewsRoute,
    ]),
    features: [
      mountFeature<NotesAssignmentsRoot, AssignmentAccess, AssignmentHooks, NotesServices>(
        assignmentFeature(assignments),
        { access: reviewAccess, hooks: reviewHooks },
      ),
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      note: noteOperations.noteGet.id,
      assignment: assignmentOperations.get.id,
      'assignment-report': assignmentOperations.reportGet.id,
    },
    plugins: [
      createReviewAutomation({
        ...(options.automationIntervalMs ? { intervalMs: options.automationIntervalMs } : {}),
        ...(options.harnesses ? { harnesses: options.harnesses } : {}),
      }),
      createPeerLinkPlugin({ surface: notesAssignmentsSurface }),
    ],
  });
}

export default createNotesAssignmentsApplication();
