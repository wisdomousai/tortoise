import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import {
  createNotesHandlers,
  createNotesState,
  noteOperations,
  notesModule,
  notesPolicy,
  type NotesServices,
  type Role,
} from '@agent-native/sample-notes/server';
import { approvalOperations } from '@agent-native/contracts';
import manifest from './manifest';
import { createTitleAutomation } from './automation';
import type { NotesAgentsRoot } from './domain';
import { createTitleHandlers } from './handlers';
import { titlesRoute } from './policy';

export interface NotesAgentsOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
  /** Between trigger loop passes; the automation plugin's default when omitted. */
  automationIntervalMs?: number;
}

/**
 * The notes module unchanged, with approval requests in their own slice, the titler agent and
 * a trigger. A run started from the note screen captures the open note, because `note` is a
 * selectable resource, and can send intents back to that screen.
 */
export function createNotesAgentsApplication(options: NotesAgentsOptions = {}) {
  return defineApplication<NotesAgentsRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({
      notes: createNotesState(ownerId, options.members),
      titles: { approvals: {} },
    }),
    handlers: [
      ...sliceHandlers<NotesAgentsRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
      ...createTitleHandlers(),
    ],
    authorization: composeAuthorization<NotesAgentsRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
      titlesRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      note: noteOperations.noteGet.id,
      'approval-request': approvalOperations.approvalGet.id,
    },
    plugins: [
      createTitleAutomation(
        options.automationIntervalMs ? { intervalMs: options.automationIntervalMs } : {},
      ),
    ],
  });
}

export default createNotesAgentsApplication();
