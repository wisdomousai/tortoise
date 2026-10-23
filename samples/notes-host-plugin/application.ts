import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import type { NotesRoot } from '@agent-native/sample-notes/application';
import {
  createNotesHandlers,
  createNotesState,
  notesModule,
  notesPolicy,
  type NotesServices,
  type Role,
} from '@agent-native/sample-notes/server';
import manifest from './manifest';
import { createActivityPlugin } from './plugins/activity/plugin';

export interface NotesHostPluginOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
  /** Between counting passes; one second when omitted. */
  activityIntervalMs?: number;
}

/**
 * The notes module unchanged, with the activity plugin. The plugin brings its own state slice,
 * handlers and policy; the application lists it here, in the manifest and in the screens.
 */
export function createNotesHostPluginApplication(options: NotesHostPluginOptions = {}) {
  return defineApplication<NotesRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({ notes: createNotesState(ownerId, options.members) }),
    handlers: sliceHandlers<NotesRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
    authorization: composeAuthorization<NotesRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      createActivityPlugin(
        options.activityIntervalMs ? { intervalMs: options.activityIntervalMs } : {},
      ),
    ],
  });
}

export default createNotesHostPluginApplication();
