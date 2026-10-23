import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import manifest from './manifest';
import {
  createNotesHandlers,
  createNotesState,
  notesModule,
  notesPolicy,
  type NotesServices,
  type NotesState,
  type Role,
} from './server';

/** Workspace state: one `notes` slice, so other modules compose next to it unchanged. */
export interface NotesRoot {
  notes: NotesState;
}

export interface NotesOptions {
  /** People who work in a new workspace besides its owner, who is always an editor. */
  members?: Record<string, Role>;
  services?: NotesServices;
}

/** The Notes sample: one module and its policy, with no plugins. */
export function createNotesApplication(options: NotesOptions = {}) {
  return defineApplication<NotesRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({ notes: createNotesState(ownerId, options.members) }),
    handlers: sliceHandlers<NotesRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
    authorization: composeAuthorization<NotesRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
    ]),
    ...(options.services ? { services: options.services } : {}),
  });
}

export default createNotesApplication();
