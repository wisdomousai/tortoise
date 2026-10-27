import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { deviceLinkOperations as ops, enrollPath } from './contracts';
import { authenticateDevice } from './hub/credentials';
import {
  deviceLinkHandlers,
  deviceLinkPolicy,
  type DeviceLinkService,
  type DeviceLinkServices,
} from './hub/handlers';
import { createAttemptLimit } from '@agent-native/host/enrollment';
import { enroll, type LinkCaller } from './hub/routes';
import { createDeviceLinkState, type DeviceLinkState } from './hub/state';
import { deviceLinkPluginManifest } from './plugin-manifest';

const listOf = (setting: string | undefined) =>
  (setting ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * The hub side of device pairing on a serving host. Its slice holds devices and enrollments by
 * digest only. Once the host listens it serves the enrollment route and resolves device
 * credentials on every request; before that both respond as unavailable. Startup refuses sync
 * operations the catalog does not contain.
 *
 * `syncOperations` is the application's default for what a field device may call; the
 * `device-link-sync-operations` setting replaces it for one deployment.
 */
export function createDeviceLinkPlugin(
  options: { readonly now?: () => number; readonly syncOperations?: readonly string[] } = {},
) {
  const now = options.now ?? Date.now;
  return defineHostPlugin<DeviceLinkState, DeviceLinkServices>({
    manifest: deviceLinkPluginManifest,
    state: { create: createDeviceLinkState },
    handlers: deviceLinkHandlers,
    authorization: { resourceTypes: ['device', 'enrollment'], port: deviceLinkPolicy },
    async open({ catalog, settings }) {
      const operations = new Set(catalog.operations.map((operation) => operation.id));
      const configured = settings['device-link-sync-operations'];
      const syncOperations =
        configured === undefined ? [...(options.syncOperations ?? [])] : listOf(configured);
      const unknown = syncOperations.filter((operation) => !operations.has(operation));
      if (unknown.length)
        throw new Error(
          `device-link-sync-operations names unknown operations: ${unknown.join(', ')}`,
        );
      const service: DeviceLinkService = { now, operations };
      const limit = createAttemptLimit(now);
      let caller: LinkCaller | undefined;
      return {
        service,
        async start(context) {
          caller = {
            application: context.application,
            workspaceId: context.workspaceId,
            context: context.delegate({
              operations: [ops.enrollmentRedeem.id, ops.credentialResolve.id],
            }),
          };
          return [{ stop: async () => void (caller = undefined) }];
        },
        publicRoute: async (request) =>
          new URL(request.url).pathname === enrollPath ? enroll(request, caller, limit) : undefined,
        authenticate: (token) => authenticateDevice(token, caller, { syncOperations, operations }),
        describe: () => ({ syncOperations }),
      };
    },
  });
}

export const deviceLinkPlugin = createDeviceLinkPlugin();
export default deviceLinkPlugin;
