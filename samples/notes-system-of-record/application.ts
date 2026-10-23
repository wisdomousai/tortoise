import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import type { NetworkPort } from '@agent-native/host/plugin';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createNotesHandlers,
  createNotesState,
  notesModule,
  notesPolicy,
  type NotesServices,
  type Role,
} from '@agent-native/sample-notes/server';
import manifest from './manifest';
import { publisherTarget, type PostedNote } from './contracts';
import { PUBLISHER_PRINCIPAL, type NotesPublishingRoot } from './domain';
import { createPublishingHandlers } from './handlers';
import { publishingRoute } from './policy';
import { publisherPort } from './publisher-port';

export interface NotesSystemOfRecordOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
  /** The connector; the REST publisher through the network port when omitted. */
  port?: (network: NetworkPort) => SystemOfRecordPort<PostedNote>;
}

/**
 * The notes module unchanged, with publishing to a REST publisher. The publisher's destination
 * is declared in the manifest and bound by the site policy; until it is bound, publications
 * wait in the outbox.
 */
export function createNotesSystemOfRecordApplication(options: NotesSystemOfRecordOptions = {}) {
  return defineApplication<NotesPublishingRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({
      notes: createNotesState(ownerId, options.members),
      publishing: { publications: {}, sync: {} },
    }),
    handlers: [
      ...sliceHandlers<NotesPublishingRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
      ...createPublishingHandlers(),
    ],
    authorization: composeAuthorization<NotesPublishingRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
      publishingRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [sitePlugin, networkPlugin, auditPlugin],
    connect: ({ application, workspaceId, network }) => ({
      integrations: [
        connectTarget<PostedNote>({
          target: publisherTarget,
          application,
          port: (options.port ?? publisherPort)(network),
          workspaceId,
          principalId: PUBLISHER_PRINCIPAL,
        }),
      ],
    }),
  });
}

export default createNotesSystemOfRecordApplication();
