import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost, type StartHostOptions } from '@tortoise/host/host';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import { defaultPorts } from '@tortoise/kernel';
import type { ApplicationDefinition } from '@tortoise/kernel/application';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { defineHostPlugin, type NetworkPort } from '@tortoise/kernel/plugin';
import { peerLinkOperations as ops } from './contracts';
import { peerLinkServiceOf } from './service';

type Reach = (url: URL, init?: RequestInit) => Promise<Response>;

/**
 * For tests of two applications: a plugin whose network port reaches each named destination
 * through its `reach`, and refuses every other destination as the kernel default does. `reach`
 * gets the URL resolved against a placeholder origin; map it onto the peer under test, and fail,
 * drop or change responses there to stand in for an unreliable network. Compose it where the
 * network plugin would be.
 */
export function peerNetworkFixture(routes: Readonly<Record<string, Reach>>) {
  const manifest = definePluginManifest({ id: 'fixture-network', title: 'Fixture network' });
  const fallback = defaultPorts().network;
  const network: NetworkPort = {
    ...fallback,
    client: (destination) => {
      const reach = Object.hasOwn(routes, destination) ? routes[destination] : undefined;
      if (!reach) return fallback.client(destination);
      return {
        destination,
        fetch: (input, init) =>
          reach(new URL(String(input), `http://${destination}.invalid`), init),
      };
    },
  };
  return {
    manifest,
    plugin: defineHostPlugin({ manifest, open: async () => ({ ports: { network } }) }),
  };
}
export type PeerNetworkFixture = ReturnType<typeof peerNetworkFixture>;

export interface PeerPairOptions {
  /** The called application, with the peer link serving its API. */
  readonly callee: ApplicationDefinition<any>;
  /** The calling application, composing `network` where the network plugin would be. */
  readonly caller: (network: PeerNetworkFixture) => ApplicationDefinition<any>;
  /** The caller's peer target and the destination it reaches the callee through. */
  readonly target: string;
  readonly destination: string;
  /** The test's own fetch, from outside both hosts, as another machine would call. */
  readonly fetch: typeof fetch;
  /** Subject mappings to make on the callee: the caller's principal ID, the callee's person. */
  readonly subjects?: Readonly<Record<string, string>>;
  /** Stand in for the network between the two; by default every request reaches the callee. */
  readonly reach?: (url: URL, init: RequestInit | undefined, callee: URL) => Promise<Response>;
  /**
   * Further host options of each side, such as a fixed port or plugin settings. A caller that
   * composes the real network plugin and binds the destination in its site policy ignores
   * `network` and `reach`.
   */
  readonly hosts?: {
    readonly callee?: Omit<StartHostOptions, 'workspacePath' | 'integration'>;
    readonly caller?: Omit<StartHostOptions, 'workspacePath' | 'integration'>;
  };
}

/**
 * Two hosts on loopback, connected the way people connect them: the callee's local user creates an
 * enrollment code, the caller's local user connects with it, and the callee maps the subjects. Neither
 * host runs its integration loops; a test drives delivery through `caller.integrations`.
 */
export async function startPeerPair(options: PeerPairOptions) {
  const directory = await mkdtemp(join(tmpdir(), 'peer-pair-'));
  const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
  const callee = await startHost(options.callee, {
    ...options.hosts?.callee,
    workspacePath: join(directory, 'callee'),
    integration: false,
  });
  const calleeUrl = new URL(callee.url);
  const reach =
    options.reach ??
    ((url: URL, init: RequestInit | undefined, origin: URL) =>
      options.fetch(new URL(url.pathname + url.search, origin), init));
  const network = peerNetworkFixture({
    [options.destination]: (url, init) => reach(url, init, calleeUrl),
  });
  const definition = options.caller(network);
  let caller: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    caller = await startHost(definition, {
      ...options.hosts?.caller,
      workspacePath: join(directory, 'caller'),
      integration: false,
    });
    const { result } = await callee.application.invokeRaw(
      {
        operation: ops.enrollmentCreate.id,
        input: { label: definition.manifest.title },
        idempotencyKey: `pair:${crypto.randomUUID()}`,
      },
      localUser,
    );
    const linked = peerLinkServiceOf(caller.services);
    if (!linked) throw new Error('The caller composes no peer link');
    const { connection } = await linked.connect(
      { target: options.target, code: (result as { code: string }).code },
      localUser,
    );
    const peerId = connection.peerId as string;
    for (const [subject, principalId] of Object.entries(options.subjects ?? {}))
      await callee.application.invokeRaw(
        {
          operation: ops.subjectMap.id,
          input: { peerId, subject, principalId },
          idempotencyKey: `pair-map:${crypto.randomUUID()}`,
        },
        localUser,
      );
    const started = caller;
    return {
      callee,
      caller: started,
      peerId,
      localUser,
      async close() {
        await started.close();
        await callee.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await caller?.close();
    await callee.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
export type PeerPair = Awaited<ReturnType<typeof startPeerPair>>;
