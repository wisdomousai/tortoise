import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { bunPlatform } from './platform/bun';
import {
  createHttpHandler,
  Sessions,
  type HostSession,
  type TokenAuthenticator,
} from '@agent-native/adapters/http';
import type { AnyApplicationDefinition } from './application';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from './embedded';
import { startAgents } from './host/agents';
import { openInstance, type Instance } from './host/instance';
import { issueAgentConnection, writeConnectionFile } from './host/connection-files';
import {
  createCleanupStack,
  type CleanupStack,
  type StartHostOptions,
  type WorkspaceOwnership,
} from './host/options';
import { routeHostRequest, type HostRouteContext } from './host/routes';
import { createShellRelay } from './host/shell-relay';
import { serveOsLanding, serveStatic } from './host/static';
import { createUiDeliveries, createUiSessions } from './host/ui-sessions';

export type { StartHostOptions } from './host/options';

/** Everything `close` stops, in the order it stops them. */
interface Running {
  readonly instance: Instance;
  readonly agents: Awaited<ReturnType<typeof startAgents>>;
  readonly server: { stop(force?: boolean): void };
  readonly ownership: WorkspaceOwnership;
  /** Set once written, so a close during startup removes only files that exist. */
  connectionFile?: string;
  agentConnectionPath?: string;
}

/**
 * A credential a plugin issued (a paired device's bearer, a signed-in person's cookie) stands for
 * the context the plugin returns. It is resolved on every request, so it carries no expiry of its
 * own, and remembers where it was presented so every recheck asks the same plugin hook.
 */
const pluginCredential =
  (instance: Instance): TokenAuthenticator =>
  async (token, via) => {
    const context = await instance.plugins.authenticate(token, via);
    return (
      context && { token, context, expiresAt: Number.POSITIVE_INFINITY, credential: token, via }
    );
  };

/** Stop once: cancel live runs, stop serving and syncing, then close state, log and ownership. */
function createClose(running: () => Running) {
  let stopped = false;
  return async function closeHost() {
    if (stopped) return;
    stopped = true;
    const { instance, agents, server, ownership } = running();
    for (const run of await agents.supervisor.list())
      if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.state))
        await agents.supervisor.cancel(run.id);
    server.stop(true);
    await Promise.all(instance.observers.map((observer) => observer.stop()));
    await instance.integrations.stop();
    agents.providers.close();
    await instance.storage.close();
    instance.runStore.close();
    const { connectionFile, agentConnectionPath } = running();
    if (connectionFile) await unlink(connectionFile).catch(() => {});
    if (agentConnectionPath) await unlink(agentConnectionPath).catch(() => {});
    await instance.plugins.close();
    await ownership.release();
  };
}

/**
 * Write the connection files clients attach with. The owner's file exists only where the local
 * owner is a trusted identity; an agent connection gets its own delegated session.
 */
async function publishConnections(
  host: { sessions: Sessions; ownerSession?: HostSession; origin: string; running: Running },
  options: StartHostOptions,
  cleanup: CleanupStack,
) {
  const { sessions, ownerSession, origin, running } = host;
  const connectionFile = ownerSession
    ? join(running.ownership.canonicalPath, '.connection.json')
    : undefined;
  if (connectionFile) {
    await writeConnectionFile(connectionFile, origin, ownerSession!.token);
    running.connectionFile = connectionFile;
  }
  const agentConnection = options.agentConnection;
  let agentSession: HostSession | undefined;
  if (agentConnection) {
    agentSession = await issueAgentConnection(sessions, agentConnection, origin);
    running.agentConnectionPath = agentConnection.path;
    cleanup.push(() => unlink(agentConnection.path).catch(() => {}));
  }
  return { connectionFile, agentSession };
}

/**
 * Start the plugins' background work, then the application's integration loops and observers
 * unless the caller drives those. Plugin observers stop with the application's.
 */
async function startBackground(instance: Instance, options: StartHostOptions, origin: string) {
  const onError = (scope: string, error: unknown) => console.error(`${scope}:`, error);
  instance.observers.push(
    ...(await instance.plugins.start({
      application: instance.application,
      workspaceId: LOCAL_WORKSPACE,
      origin,
      delegate: (grant) => ({
        workspaceId: LOCAL_WORKSPACE,
        principalId: LOCAL_OWNER,
        grant: { ...grant, principalId: LOCAL_OWNER, workspaceId: LOCAL_WORKSPACE },
      }),
      onError,
    })),
  );
  if (options.integration === false) return;
  instance.integrations.start(options.integration);
  if (instance.connections.observe)
    instance.observers.push(
      // A failed observation pass is retried; its details stay in the host log.
      ...(await instance.connections.observe(onError)),
    );
}

/**
 * What the UI and shell routes reach: UI sessions, deliveries from OS requests, the composed
 * shell port and the relay through which an adapter in another process attaches to it.
 */
function uiRoutes(
  instance: Instance,
  definition: AnyApplicationDefinition,
  sessions: Sessions,
  cleanup: ReturnType<typeof createCleanupStack>,
) {
  const { application, ports } = instance;
  const selectable = definition.selectableResources ?? {};
  const shellRelay = createShellRelay(
    () => ports.shell,
    (token) => !!sessions.get(token),
  );
  cleanup.push(() => shellRelay.close());
  return {
    application,
    sessions,
    uiSessions: createUiSessions(application, sessions, selectable),
    uiDeliveries: createUiDeliveries(application, sessions, selectable),
    shell: ports.shell,
    shellRelay,
  };
}

/**
 * One local instance owns the workspace and hosts exactly one application. Browser,
 * native and process clients attach via authenticated HTTP. The application's integrations and
 * observers come from its own `connect`; the host names no system of record and no station.
 *
 * The application's plugins provide the ports. The listener is loopback unless a plugin
 * provides the ingress port, and every API call still needs a session. The identity port decides
 * who the first session belongs to: the OS account that started the host when it admits the
 * local owner, otherwise only the launcher's delegated grant, with no owner credential file.
 */
export async function startHost(definition: AnyApplicationDefinition, options: StartHostOptions) {
  await mkdir(options.workspacePath, { recursive: true });
  const ownership = await (options.platform ?? bunPlatform).acquireOwnership(options.workspacePath);
  const cleanup = createCleanupStack(() => ownership.release());
  try {
    const instance = await openInstance(definition, options, ownership, cleanup);
    const { application, ports } = instance;
    const sessions = new Sessions();
    let origin = '';
    const agents = await startAgents(
      instance,
      options,
      ownership,
      { sessions, origin: () => origin },
      cleanup,
    );
    const ownerSession: HostSession | undefined = instance.localOwner
      ? sessions.create(
          { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER },
          365 * 86_400_000,
        )
      : undefined;
    let running: Running | undefined;
    const close = createClose(() => running!);
    const routes: HostRouteContext = {
      ...uiRoutes(instance, definition, sessions, cleanup),
      ...agents,
      harnesses: options.harnesses,
      shutdown: { ownerSession, instance: ownership.instance, close },
    };
    const handler = createHttpHandler({
      application,
      sessions,
      origin: () => origin,
      pollMs: options.pollMs,
      publicRoute: async (request) =>
        (await agents.providers.callback(request)) ??
        (await serveOsLanding(options.webRoot, request)) ??
        instance.plugins.publicRoute(request),
      authenticateToken: pluginCredential(instance),
      extra: async (request, session) =>
        (await routeHostRequest(request, session, routes)) ??
        instance.plugins.route(request, { ...session.context, channel: 'http' }),
      static: (path) => serveStatic(options.webRoot, path),
    });
    const { server, origin: listening } = ports.ingress.listen(options.port, handler);
    cleanup.push(() => {
      server.stop(true);
    });
    origin = listening;
    running = { instance, agents, server, ownership };
    await ownership.publish(origin);
    const { connectionFile, agentSession } = await publishConnections(
      { sessions, ownerSession, origin, running },
      options,
      cleanup,
    );
    await startBackground(instance, options, origin);
    return {
      url: origin,
      workspacePath: ownership.canonicalPath,
      connectionFile,
      instance: ownership.instance,
      // The browser opens as whoever the identity floor admits: the owner, or the delegate.
      launchUrl: `${origin}/#launch=${sessions.launch((ownerSession ?? agentSession)!)}`,
      sessions,
      application,
      /** Services the plugins expose, keyed by plugin id. */
      services: instance.plugins.services,
      /** Facts each plugin reports for the `listening` record, keyed by plugin id. */
      plugins: instance.plugins.describe(),
      supervisor: agents.supervisor,
      integrations: instance.integrations,
      close,
    };
  } catch (error) {
    await cleanup.run();
    throw error;
  }
}
