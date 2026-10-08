import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import { createHttpHandler, Sessions, type HostSession } from '@agent-native/adapters/http';
import type { AnyApplicationDefinition } from './application';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from './embedded';
import { startAgents } from './host/agents';
import { openAuthority, type Authority } from './host/authority';
import { issueAgentConnection, writeConnectionFile } from './host/connection-files';
import { listen } from './host/listener';
import {
  createCleanupStack,
  type CleanupStack,
  type StartHostOptions,
  type WorkspaceOwnership,
} from './host/options';
import { routeHostRequest, type HostRouteContext } from './host/routes';
import { serveStatic } from './host/static';
import { createUiSessions } from './host/ui-sessions';

export type { StartHostOptions } from './host/options';

/** Everything `close` stops, in the order it stops them. */
interface Running {
  readonly authority: Authority;
  readonly agents: Awaited<ReturnType<typeof startAgents>>;
  readonly server: { stop(force?: boolean): void };
  readonly ownership: WorkspaceOwnership;
  /** Set once written, so a close during startup removes only files that exist. */
  connectionFile?: string;
  agentConnectionPath?: string;
}

/** Stop once: cancel live runs, stop serving and syncing, then close state, log and ownership. */
function createClose(running: () => Running) {
  let stopped = false;
  return async function closeHost() {
    if (stopped) return;
    stopped = true;
    const { authority, agents, server, ownership } = running();
    for (const run of await agents.supervisor.list())
      if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.state))
        await agents.supervisor.cancel(run.id);
    server.stop(true);
    await Promise.all(authority.observers.map((observer) => observer.stop()));
    await authority.integrations.stop();
    agents.providers.close();
    await authority.storage.close();
    authority.runStore.close();
    const { connectionFile, agentConnectionPath } = running();
    if (connectionFile) await unlink(connectionFile).catch(() => {});
    if (agentConnectionPath) await unlink(agentConnectionPath).catch(() => {});
    await authority.security.close();
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

/** Start the application's integration loops and observers, unless the caller drives them. */
async function startBackground(authority: Authority, options: StartHostOptions) {
  if (options.integration === false) return;
  authority.integrations.start(options.integration);
  if (authority.connections.observe)
    authority.observers.push(
      // A failed observation pass is retried; its details stay in the host log.
      ...(await authority.connections.observe((scope, error) => console.error(`${scope}:`, error))),
    );
}

/**
 * One local authority owns the workspace and hosts exactly one application (P11). Browser,
 * native and process clients attach via authenticated HTTP. The application's integrations and
 * observers come from its own `connect`; the host names no system of record and no station.
 *
 * The site policy applies to every application (P13). The listener is loopback by default; the
 * policy can select a mutual TLS listener instead, and every API call still needs a session.
 * Its identity floor decides who the first session belongs to:
 * - `local-owner`: the OS account that started the host.
 * - `grant-file`: only the launcher's delegated grant; no owner session or credential file.
 * - `external`: refuses to start, because no identity adapter is composed.
 */
export async function startHost(definition: AnyApplicationDefinition, options: StartHostOptions) {
  await mkdir(options.workspacePath, { recursive: true });
  const ownership = await acquireWorkspaceOwnership(options.workspacePath);
  const cleanup = createCleanupStack(() => ownership.release());
  try {
    const authority = await openAuthority(definition, options, ownership, cleanup);
    const { application, security } = authority;
    const sessions = new Sessions();
    let origin = '';
    const agents = await startAgents(
      authority,
      options,
      ownership,
      { sessions, origin: () => origin },
      cleanup,
    );
    const ownerSession: HostSession | undefined = authority.localOwner
      ? sessions.create(
          { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER },
          365 * 86_400_000,
        )
      : undefined;
    let running: Running | undefined;
    const close = createClose(() => running!);
    const routes: HostRouteContext = {
      application,
      sessions,
      uiSessions: createUiSessions(application, sessions, definition.selectableResources ?? {}),
      ...agents,
      harnesses: options.harnesses,
      shutdown: { ownerSession, instance: ownership.instance, close },
    };
    const handler = createHttpHandler({
      application,
      sessions,
      origin: () => origin,
      pollMs: options.pollMs,
      publicRoute: agents.providers.callback,
      extra: (request, session) => routeHostRequest(request, session, routes),
      static: (path) => serveStatic(options.webRoot, path),
    });
    const { server, origin: listening } = listen(security, options.port, handler);
    cleanup.push(() => {
      server.stop(true);
    });
    origin = listening;
    running = { authority, agents, server, ownership };
    await ownership.publish(origin);
    const { connectionFile, agentSession } = await publishConnections(
      { sessions, ownerSession, origin, running },
      options,
      cleanup,
    );
    await startBackground(authority, options);
    return {
      url: origin,
      workspacePath: ownership.canonicalPath,
      connectionFile,
      instance: ownership.instance,
      // The browser opens as whoever the identity floor admits: the owner, or the delegate.
      launchUrl: `${origin}/#launch=${sessions.launch((ownerSession ?? agentSession)!)}`,
      sessions,
      application,
      security,
      supervisor: agents.supervisor,
      integrations: authority.integrations,
      close,
    };
  } catch (error) {
    await cleanup.run();
    throw error;
  }
}
