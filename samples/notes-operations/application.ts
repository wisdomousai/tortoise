import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { createTelemetryPlugin } from '@agent-native/telemetry/plugin';
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
import { notesMigrations } from './migrations';

export interface NotesOperationsOptions {
  members?: Record<string, Role>;
  services?: NotesServices;
  /** Between telemetry exports; one minute when omitted. */
  telemetryIntervalMs?: number;
}

/**
 * The notes module unchanged, at state version 2, with the plugins that run it on a site: the
 * deployment policy (site), the egress guard (network), the audit log and the OpenTelemetry
 * exporter. The plugins add no capabilities the screens need.
 */
export function createNotesOperationsApplication(options: NotesOperationsOptions = {}) {
  return defineApplication<NotesRoot, NotesServices>({
    manifest,
    createState: (ownerId) => ({ notes: createNotesState(ownerId, options.members) }),
    migrations: notesMigrations,
    handlers: sliceHandlers<NotesRoot, 'notes', NotesServices>('notes', createNotesHandlers()),
    authorization: composeAuthorization<NotesRoot>([
      authorizationRoute('notes', notesModule, ['note'], notesPolicy),
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createTelemetryPlugin(
        options.telemetryIntervalMs ? { intervalMs: options.telemetryIntervalMs } : {},
      ),
    ],
  });
}

export default createNotesOperationsApplication();
