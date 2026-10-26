import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  connectWorklist,
  createWorklistSlice,
  worklistHandlers,
} from '@agent-native/assignments/server';
import { createPeerLinkPlugin, peerLinkServiceOf } from '@agent-native/peer-link/plugin';
import {
  createNotesHandlers,
  createNotesState,
  notesModule,
  notesPolicy,
  type NotesServices,
  type Role,
} from '@agent-native/sample-notes/server';
import manifest from './manifest';
import { worklist } from './contracts';
import { INTEGRATION_PRINCIPAL, type NotesWorklistRoot } from './domain';
import { worklistRoute } from './policy';

export interface NotesWorklistOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
}

/**
 * The notes module unchanged, with a worklist of the note reviews notes-assignments sends here.
 * The owner connects to notes-assignments on the peers screen with a code its owner created.
 * Reviews arrive through inbound sync; reports and done marks leave through the outbox, and each
 * shows whether notes-assignments took it.
 */
export function createNotesWorklistApplication(options: NotesWorklistOptions = {}) {
  return defineApplication<NotesWorklistRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({
      notes: createNotesState(ownerId, options.members),
      worklist: createWorklistSlice(),
    }),
    handlers: [
      ...sliceHandlers<NotesWorklistRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
      ...worklistHandlers<NotesWorklistRoot, NotesServices, (typeof worklist.kinds)[number]>(
        worklist,
        {
          slice: (state) => state.worklist,
          newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
          now: (ctx) => (ctx.services.now ?? Date.now)(),
        },
      ),
    ],
    authorization: composeAuthorization<NotesWorklistRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
      worklistRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createPeerLinkPlugin({ targets: [worklist.target] }),
    ],
    connect: ({ application, workspaceId, services }) => ({
      integrations: [
        connectWorklist(worklist, {
          application,
          workspaceId,
          principalId: INTEGRATION_PRINCIPAL,
          client: () => peerLinkServiceOf(services)!.link(worklist.target.target).client(),
          reconnect: {
            missing: 'connect it on the peers screen',
            refused: 'connect it again on the peers screen',
          },
        }),
      ],
    }),
  });
}

export default createNotesWorklistApplication();
