import type { PeerApi, PeerTarget } from '@agent-native/contracts';
import { createAttemptLimit } from '@agent-native/host/enrollment';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { connectPath, enrollPath, peerLinkOperations as ops } from './contracts';
import { authenticatePeer, createReplayCache } from './inbound/credentials';
import { peerLinkHandlers, peerLinkPolicy } from './inbound/handlers';
import { enroll, type PeerCaller } from './inbound/routes';
import { connectionHandlers } from './outbound/handlers';
import { createOutbound } from './outbound/link';
import { connect, connectRoute, type ConnectOptions } from './outbound/routes';
import { connectionSecrets } from './outbound/secrets';
import type { OutboundTarget, PeerLinkService, PeerLinkServices } from './service';
import { createPeerLinkState, type PeerLinkState } from './state';
import { peerLinkPluginManifest } from './plugin-manifest';

export type { OutboundTarget, PeerLinkService, PeerLinkServices } from './service';
export { peerLinkServiceOf } from './service';

export interface PeerLinkOptions {
  /** What peers may call here. Without one this application takes no calls from peers. */
  readonly api?: PeerApi;
  /** The peer targets this application calls (`definePeerTarget`). */
  readonly targets?: readonly Pick<PeerTarget, 'target' | 'destination' | 'api'>[];
  /**
   * Whether a call on behalf of a person that an agent or job run made on the caller is
   * accepted. `refuse` by default; the `peer-link-agents` setting replaces it.
   */
  readonly agents?: 'refuse' | 'allow';
  /**
   * Principals no subject is ever mapped to, besides every ID with a `:` (`peer:`, `device:`):
   * the application's integration principals, for example.
   */
  readonly reserved?: readonly string[];
  readonly now?: () => number;
}

const empty: readonly string[] = [];

/**
 * The peer link on a serving host, with both sides in one plugin.
 *
 * - Called side: its slice holds peers, enrollments and subject mappings, with only digests of
 *   codes and credentials. Once the host listens it serves the enrollment route and resolves
 *   peer credentials and subject assertions on every request; before that both respond as
 *   unavailable. Startup refuses an API of another application or one that names operations
 *   the catalog does not contain.
 * - Calling side: the connect route enrolls with a peer target through the network port, the
 *   secret store keeps the credential and key, and `services['peer-link'].link(target)` gives
 *   `connectPeerTarget` and `createPeerSource` their clients.
 */
export function createPeerLinkPlugin(options: PeerLinkOptions = {}) {
  const now = options.now ?? Date.now;
  const reservedIds = new Set(options.reserved ?? []);
  const reserved = (principalId: string) =>
    principalId.includes(':') || reservedIds.has(principalId);
  const targets = new Map<string, OutboundTarget>(
    (options.targets ?? []).map((target) => [
      target.target,
      { application: target.api.application, destination: target.destination.id },
    ]),
  );
  return defineHostPlugin<PeerLinkState, PeerLinkServices>({
    manifest: peerLinkPluginManifest,
    state: { create: createPeerLinkState },
    handlers: [...peerLinkHandlers, ...connectionHandlers],
    authorization: {
      resourceTypes: ['peer', 'peer-enrollment', 'peer-connection'],
      port: peerLinkPolicy,
    },
    async open({ catalog, manifest, settings, secrets, workspacePath, ports }) {
      const { api } = options;
      if (api && api.application !== manifest.id)
        throw new Error(`The peer API of ${api.application} cannot be served by ${manifest.id}`);
      const known = new Set(catalog.operations.map((operation) => operation.id));
      const operations = [
        ...(api?.serviceOperations ?? empty),
        ...(api?.onBehalfOfOperations ?? empty),
      ];
      const unknown = operations.filter((operation) => !known.has(operation));
      if (unknown.length)
        throw new Error(`The peer API names unknown operations: ${unknown.join(', ')}`);
      const setting = settings['peer-link-agents'];
      if (setting !== undefined && setting !== 'refuse' && setting !== 'allow')
        throw new Error('peer-link-agents must be refuse or allow');
      const agents = setting ?? options.agents ?? 'refuse';
      const serviceOperations = api?.serviceOperations ?? empty;
      const onBehalfOfOperations = api?.onBehalfOfOperations ?? empty;
      const limit = createAttemptLimit(now);
      const replay = createReplayCache();
      const stored = connectionSecrets(secrets, workspacePath);
      let caller: PeerCaller | undefined;
      const outbound = createOutbound({
        targets,
        secrets: stored,
        network: () => ports.network,
        caller: () => caller,
        now,
      });
      const connecting: ConnectOptions = {
        targets,
        secrets: stored,
        network: () => ports.network,
        outbound,
        caller: () => caller,
      };
      const service: PeerLinkService = {
        now,
        application: manifest.id,
        serviceOperations: new Set(serviceOperations),
        onBehalfOfOperations: new Set(onBehalfOfOperations),
        reserved,
        targets,
        link: (target) => outbound.link(target),
        connect: (request, context) => connect(request, context, connecting),
      };
      return {
        service,
        async start(context) {
          caller = {
            application: context.application,
            workspaceId: context.workspaceId,
            context: context.delegate({
              operations: [
                ops.enrollmentRedeem.id,
                ops.credentialResolve.id,
                ops.connectionList.id,
              ],
            }),
          };
          return [{ stop: async () => void (caller = undefined) }];
        },
        publicRoute: async (request) =>
          new URL(request.url).pathname === enrollPath ? enroll(request, caller, limit) : undefined,
        route: async (request, context) =>
          new URL(request.url).pathname === connectPath
            ? connectRoute(request, context, connecting)
            : undefined,
        authenticate: (token, request) =>
          authenticatePeer(token, request, caller, {
            now,
            serviceOperations,
            onBehalfOfOperations,
            agents,
            replay,
          }),
        describe: () => ({
          serves: [...serviceOperations, ...onBehalfOfOperations],
          calls: [...targets.keys()],
          agents,
        }),
      };
    },
  });
}

export const peerLinkPlugin = createPeerLinkPlugin();
export default peerLinkPlugin;
