import type { PeerSurface } from '@agent-native/contracts';
import { createAttemptLimit } from '@agent-native/host/enrollment';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { enrollPath, peerLinkOperations as ops } from './contracts';
import { authenticatePeer, createReplayCache } from './inbound/credentials';
import {
  peerLinkHandlers,
  peerLinkPolicy,
  type PeerLinkService,
  type PeerLinkServices,
} from './inbound/handlers';
import { enroll, type PeerCaller } from './inbound/routes';
import { createPeerLinkState, type PeerLinkState } from './inbound/state';
import { peerLinkPluginManifest } from './plugin-manifest';

export interface PeerLinkOptions {
  /** What peers may call here. Without one this application takes no calls from peers. */
  readonly surface?: PeerSurface;
  /**
   * Whether a call on behalf of a person that a delegated run (an agent or a job) made on the
   * caller is accepted. `refuse` by default; the `peer-link-agents` setting replaces it.
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
 * The peer link on a serving host. Its slice holds peers, enrollments and subject mappings, and
 * keeps only digests of codes and credentials. Once the host listens it serves the enrollment
 * route and resolves peer credentials and subject assertions on every request; before that both
 * answer as unavailable. Startup refuses a surface of another application or one that names
 * operations the catalog does not contain.
 */
export function createPeerLinkPlugin(options: PeerLinkOptions = {}) {
  const now = options.now ?? Date.now;
  const reservedIds = new Set(options.reserved ?? []);
  const reserved = (principalId: string) =>
    principalId.includes(':') || reservedIds.has(principalId);
  return defineHostPlugin<PeerLinkState, PeerLinkServices>({
    manifest: peerLinkPluginManifest,
    state: { create: createPeerLinkState },
    handlers: peerLinkHandlers,
    authorization: {
      resourceTypes: ['peer', 'peer-enrollment'],
      port: peerLinkPolicy,
    },
    async open({ catalog, manifest, settings }) {
      const { surface } = options;
      if (surface && surface.application !== manifest.id)
        throw new Error(
          `The peer surface of ${surface.application} cannot be served by ${manifest.id}`,
        );
      const known = new Set(catalog.operations.map((operation) => operation.id));
      const operations = [
        ...(surface?.serviceOperations ?? empty),
        ...(surface?.onBehalfOfOperations ?? empty),
      ];
      const unknown = operations.filter((operation) => !known.has(operation));
      if (unknown.length)
        throw new Error(`The peer surface names unknown operations: ${unknown.join(', ')}`);
      const setting = settings['peer-link-agents'];
      if (setting !== undefined && setting !== 'refuse' && setting !== 'allow')
        throw new Error('peer-link-agents must be refuse or allow');
      const agents = setting ?? options.agents ?? 'refuse';
      const serviceOperations = surface?.serviceOperations ?? empty;
      const onBehalfOfOperations = surface?.onBehalfOfOperations ?? empty;
      const service: PeerLinkService = {
        now,
        application: manifest.id,
        serviceOperations: new Set(serviceOperations),
        onBehalfOfOperations: new Set(onBehalfOfOperations),
        reserved,
      };
      const limit = createAttemptLimit(now);
      const replay = createReplayCache();
      let caller: PeerCaller | undefined;
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
        authenticate: (token, request) =>
          authenticatePeer(token, request, caller, {
            now,
            serviceOperations,
            onBehalfOfOperations,
            agents,
            replay,
          }),
        describe: () => ({ serves: [...serviceOperations, ...onBehalfOfOperations], agents }),
      };
    },
  });
}

export const peerLinkPlugin = createPeerLinkPlugin();
export default peerLinkPlugin;
