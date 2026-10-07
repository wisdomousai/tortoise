import { Database } from 'bun:sqlite';
import { mkdir, writeFile, chmod, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ExecutionContext, type DelegationGrant } from '@agent-native/runtime';
import type { SystemOfRecordPort } from '@agent-native/integration';
import { ApplicationError, canonicalJson } from '@agent-native/contracts';
import { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import {
  createHttpHandler,
  jsonResponse,
  readJsonBody,
  Sessions,
  type HostSession,
} from '@agent-native/adapters/http';
import { UiSessionStore, type UiContextInput } from '@agent-native/adapters/ui-sessions';
import type { UiIntent } from '@agent-native/react';
import {
  createApplicationRuntime,
  createLineIntegration,
  createQualityIntegration,
  selectableResources,
} from './composition';
import { FakeMes, type MesItem } from '../../../examples/line-station/fake-mes';
import { startStationBridge, type StationBridgeConfig } from './station-bridge';
import { LOCAL_WORKSPACE, workspaceStorage } from './embedded';
import { FakeQualitySystem, type QualityItem } from '../../../examples/quality-inspection/fake-sor';
import { createRunSupervisor } from '@agent-native/agents/supervisor';
import { DeterministicHarness } from '@agent-native/agents/deterministic';
import type { Harness, RunSnapshot, RunStore } from '@agent-native/agents/types';
import { createProviderAccess } from './providers';
import { openSecurity, type SecurityOptions } from './security';

/** Run snapshots are separate from business transactions; a completed run is never a commit receipt. */
class SQLiteRunStore implements RunStore {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)',
    );
  }
  async get(id: string) {
    const row = this.db.query('SELECT snapshot FROM runs WHERE id=?').get(id) as {
      snapshot: string;
    } | null;
    return row ? (JSON.parse(row.snapshot) as RunSnapshot) : undefined;
  }
  async list() {
    return (
      this.db.query('SELECT snapshot FROM runs ORDER BY rowid').all() as { snapshot: string }[]
    ).map((row) => JSON.parse(row.snapshot) as RunSnapshot);
  }
  async save(snapshot: RunSnapshot) {
    this.db
      .query(
        'INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot',
      )
      .run(snapshot.id, JSON.stringify(snapshot));
  }
  close() {
    this.db.close();
  }
}

/**
 * One local authority owns the workspace. Browser, native and process clients attach via
 * authenticated loopback HTTP. Tests may inject sessions; production always starts as local owner.
 */
export async function startHost(options: {
  workspacePath: string;
  port?: number;
  webRoot?: string;
  harnesses?: readonly Harness[];
  runtimeManifest?: string;
  pollMs?: number;
  /**
   * Quality system of record. Defaults to the deterministic in-memory fake so the reference runs
   * without enterprise credentials; a real adapter is injected by the deploying application.
   */
  systemOfRecord?: SystemOfRecordPort<QualityItem>;
  /**
   * Line stations: the MES port (defaults to the in-memory homebrew MES fake) and, when given,
   * the station screens to bridge. Without `stations` nothing touches any station software.
   */
  lineStation?: { mes?: SystemOfRecordPort<MesItem>; stations?: readonly StationBridgeConfig[] };
  /** Background delivery/sync cadence; tests may disable the loops and drive passes directly. */
  integration?: { deliverMs?: number; syncMs?: number } | false;
  /**
   * Issue a second connection file bound to a delegated context, for an agent that runs as a
   * different OS user and must not read the owner's credential. The context comes from trusted
   * launcher configuration (see `readGrantFile`); the session expires with the grant.
   */
  agentConnection?: { context: ExecutionContext; path: string };
  /**
   * Site policy and audit log location. Absent: isolated network posture and a fail-closed log in
   * `<workspace>/audit`. Every outbound connection of the host goes through the egress guard
   * built from this policy, and every business action is recorded in the log.
   */
  security?: SecurityOptions;
}) {
  await mkdir(options.workspacePath, { recursive: true });
  const ownership = await acquireWorkspaceOwnership(options.workspacePath);
  const startupCleanup: (() => void | Promise<void>)[] = [() => ownership.release()];
  try {
    // Policy first: an unusable policy or an unwritable audit log stops startup before the
    // workspace is opened. Closed last, after everything that might still audit.
    const security = await openSecurity({
      ...options.security,
      workspacePath: ownership.canonicalPath,
      component: 'authority',
      instance: ownership.instance,
      childProxy: true,
    });
    startupCleanup.unshift(() => security.close());
    const storage = workspaceStorage(ownership.canonicalPath);
    startupCleanup.unshift(() => storage.close());
    const runStore = new SQLiteRunStore(join(ownership.canonicalPath, 'runs.sqlite'));
    startupCleanup.unshift(() => runStore.close());
    const application = createApplicationRuntime({
      storage,
      eventLog: security.eventLog,
      services: { assurance: security.monitor },
    });
    // Attest what is running, then resolve audit entries a crash left open. Both precede any
    // integration pass or request, so no new command reuses a cursor recovery compares against.
    await security.attest({ instance: ownership.instance });
    await security.recover(application);
    security.monitor.start();
    const systemOfRecord = options.systemOfRecord ?? new FakeQualitySystem();
    const integration = createQualityIntegration({
      application,
      port: systemOfRecord,
      workspaceId: LOCAL_WORKSPACE,
    });
    startupCleanup.unshift(() => integration.stop());
    const mes = options.lineStation?.mes ?? new FakeMes();
    const lineIntegration = createLineIntegration({
      application,
      port: mes,
      workspaceId: LOCAL_WORKSPACE,
    });
    startupCleanup.unshift(() => lineIntegration.stop());
    const bridges: { stop(): Promise<void> }[] = [];
    startupCleanup.unshift(async () => {
      await Promise.all(bridges.map((bridge) => bridge.stop()));
    });
    const sessions = new Sessions();
    let origin = '';
    const providers = await createProviderAccess({
      workspacePath: ownership.canonicalPath,
      origin: () => origin,
      sessions: (token) => sessions.get(token),
      runtimeManifest: options.runtimeManifest,
      // Provider SDKs reach only the bound OpenAI destinations; provider CLIs get proxy settings
      // that tunnel only to the destinations their process declaration lists.
      fetch: security.egress.routedFetch(['openai-auth', 'openai-api']),
      childEnvironment: (processId) => security.proxy!.childEnvironment(processId),
    });
    startupCleanup.unshift(() => providers.close());
    const ownerSession = sessions.create(
      { workspaceId: LOCAL_WORKSPACE, principalId: 'owner' },
      365 * 86_400_000,
    );
    async function validateResources(context: ExecutionContext, input: UiContextInput) {
      for (const resource of input.selectedResources) {
        const [kind, ...idParts] = resource.split(':');
        const id = idParts.join(':');
        const operation = Object.hasOwn(selectableResources, kind ?? '')
          ? selectableResources[kind!]
          : undefined;
        if (!operation || !id)
          throw new ApplicationError('INVALID_INPUT', 'Unknown selected resource type');
        const snapshot = await application.queryRaw({ operation, input: { id } }, context);
        const revision = (snapshot.data as { revision: number }).revision;
        if ((input.observedRevisions[resource] ?? 0) > revision)
          throw new ApplicationError('CONFLICT', 'Observed revision is ahead of authority');
      }
    }
    const uiSessions = new UiSessionStore({
      isActive: (token) => !!sessions.get(token),
      validateContext: validateResources,
      async validateIntent(context, intent) {
        if ('resource' in intent)
          await validateResources(context, {
            selectedResources: [intent.resource],
            observedRevisions: { [intent.resource]: 0 },
          });
        else if (
          intent.operations.some(
            (id) => !application.catalog.operations.some((operation) => operation.id === id),
          )
        )
          throw new ApplicationError('INVALID_INPUT', 'Unknown review operation');
      },
    });
    const supervisor = createRunSupervisor({
      harnesses: [new DeterministicHarness(), ...providers.harnesses, ...(options.harnesses ?? [])],
      store: runStore,
      tools: {
        definitions: application.catalog.operations.map((operation) => ({
          operation: operation.id,
          description: operation.description || operation.id,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              input: operation.inputSchema,
              expectedRevisions: {
                type: 'object',
                additionalProperties: { type: 'integer', minimum: 0 },
              },
            },
            required: ['input'],
          },
        })),
        async execute(operation, input, toolContext) {
          const run = await supervisor.get(toolContext.runId);
          if (
            !run ||
            typeof run.context.principalId !== 'string' ||
            typeof run.context.workspaceId !== 'string'
          )
            throw new ApplicationError('FORBIDDEN', 'Run authority unavailable');
          const body = input as { input?: unknown; expectedRevisions?: Record<string, number> };
          if (!body || typeof body !== 'object' || !('input' in body))
            throw new ApplicationError('INVALID_INPUT', 'Tool requires an input envelope');
          // This snapshot was captured from the authenticated session, never from prompt/tool
          // arguments. Delegating a run can narrow authority but cannot restore absent grants.
          const initiatingGrant = run.context.grant as DelegationGrant | undefined;
          const context: ExecutionContext = {
            principalId: run.context.principalId,
            workspaceId: run.context.workspaceId,
            runId: run.id,
            channel: 'harness',
            signal: toolContext.signal,
            grant: {
              ...initiatingGrant,
              operations:
                initiatingGrant?.operations ??
                application.catalog.operations.map((value) => value.id),
              runId: run.id,
              principalId: run.context.principalId,
              workspaceId: run.context.workspaceId,
            },
          };
          const definition = application.catalog.operations.find((value) => value.id === operation);
          if (!definition) throw new ApplicationError('NOT_FOUND', 'Unknown operation');
          const request = {
            operation,
            input: body.input,
            expectedRevisions: body.expectedRevisions,
            idempotencyKey: `${run.id}:${toolContext.idempotencyKey ?? crypto.randomUUID()}`,
          };
          return definition.kind === 'query'
            ? application.queryRaw(request, context)
            : application.invokeRaw(request, context);
        },
      },
    });
    await supervisor.recoverInterrupted();
    function ownsRun(run: RunSnapshot, session: HostSession) {
      const grant = session.context.grant;
      return (
        run.context.principalId === session.context.principalId &&
        run.context.workspaceId === session.context.workspaceId &&
        (grant?.expiresAt === undefined || grant.expiresAt > Date.now()) &&
        canonicalJson(run.context.grant ?? null) === canonicalJson(grant ?? null)
      );
    }
    async function visibleRun(run: RunSnapshot, context: ExecutionContext) {
      const current = await application.events(0, context);
      if (run.context.authorizationRevision === current.authorizationRevision) return run;
      // Free-form model text cannot be reprojected like a typed domain DTO. A policy
      // generation change hides old output and target context instead of leaking it again.
      return {
        id: run.id,
        harnessId: run.harnessId,
        conversationId: run.conversationId,
        state: run.state,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        events: [],
        context: {},
        historyUnavailable: true,
      };
    }
    const handler = createHttpHandler({
      application,
      sessions,
      origin: () => origin,
      pollMs: options.pollMs,
      publicRoute: providers.callback,
      async extra(request, session) {
        const url = new URL(request.url);
        const providerResponse = await providers.route(request, session);
        if (providerResponse) return providerResponse;
        if (url.pathname === '/api/v1/shutdown' && request.method === 'POST') {
          const body = await readJsonBody(request);
          if (
            request.headers.get('authorization') !== `Bearer ${ownerSession.token}` ||
            body.instance !== ownership.instance
          )
            throw new ApplicationError(
              'FORBIDDEN',
              'Only the owning native host can stop this authority instance',
            );
          setTimeout(() => void closeHost(), 25);
          return jsonResponse({ stopping: true });
        }
        if (url.pathname === '/api/v1/ui/sessions' && request.method === 'POST')
          return jsonResponse(
            await uiSessions.register(
              session,
              (await readJsonBody(request)) as unknown as UiContextInput,
            ),
          );
        const uiRoute = url.pathname.match(
          /^\/api\/v1\/ui\/sessions\/([^/]+)(?:\/(intents|ack))?$/,
        );
        if (uiRoute) {
          const id = uiRoute[1]!;
          if (!uiRoute[2] && request.method === 'POST') {
            const body = await readJsonBody(request);
            return jsonResponse(
              await uiSessions.update(
                session,
                id,
                body.context as UiContextInput,
                typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
              ),
            );
          }
          if (uiRoute[2] === 'intents' && request.method === 'GET') {
            const before = await application.events(0, session.context);
            const candidates = await uiSessions.poll(session, id);
            // Candidate validation may await multiple reads. Fence the entire batch against
            // local policy changes and enqueue under the authority's serialized read boundary.
            return new Response(
              new ReadableStream<Uint8Array>({
                async start(controller) {
                  try {
                    await application.deliverEvents(0, session.context, (batch) => {
                      const current =
                        !!sessions.get(session.token) &&
                        !request.signal.aborted &&
                        before.authorizationRevision === batch.authorizationRevision;
                      controller.enqueue(
                        new TextEncoder().encode(JSON.stringify(current ? candidates : [])),
                      );
                      controller.close();
                    });
                  } catch {
                    controller.enqueue(new TextEncoder().encode('[]'));
                    controller.close();
                  }
                },
              }),
              { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
            );
          }
          if (uiRoute[2] === 'intents' && request.method === 'POST')
            return jsonResponse({
              id: await uiSessions.send(
                session,
                id,
                (await readJsonBody(request)) as unknown as UiIntent,
              ),
            });
          if (uiRoute[2] === 'ack' && request.method === 'POST') {
            const body = await readJsonBody(request);
            if (
              typeof body.id !== 'string' ||
              !['accepted', 'rejected'].includes(String(body.status))
            )
              throw new ApplicationError('INVALID_INPUT', 'Invalid intent acknowledgement');
            uiSessions.acknowledge(session, id, body.id, body.status as 'accepted' | 'rejected');
            return jsonResponse({ acknowledged: true });
          }
        }
        if (url.pathname === '/api/v1/runs' && request.method === 'GET')
          return jsonResponse(
            await Promise.all(
              (await supervisor.list())
                .filter((run) => ownsRun(run, session))
                .map((run) => visibleRun(run, session.context)),
            ),
          );
        if (url.pathname === '/api/v1/runs' && request.method === 'POST') {
          if (
            session.context.runId ||
            session.context.grant?.runId ||
            session.context.signal?.aborted ||
            (session.context.grant?.expiresAt !== undefined &&
              session.context.grant.expiresAt <= Date.now())
          )
            throw new ApplicationError(
              'FORBIDDEN',
              'An active user delegation is required; nested run delegation is not supported',
            );
          const body = await readJsonBody(request);
          if (
            !body ||
            typeof body !== 'object' ||
            !('prompt' in body) ||
            typeof body.prompt !== 'string' ||
            !('harnessId' in body) ||
            typeof body.harnessId !== 'string'
          )
            throw new ApplicationError('INVALID_INPUT', 'Run requires harnessId and prompt');
          if (body.prompt.length > 32_000)
            throw new ApplicationError('INVALID_INPUT', 'Run prompt exceeds limit');
          const captured =
            typeof body.uiSessionId === 'string'
              ? await uiSessions.capture(session, body.uiSessionId)
              : undefined;
          if (
            captured &&
            body.uiContextVersion !== undefined &&
            captured.version !== body.uiContextVersion
          )
            throw new ApplicationError('CONFLICT', 'UI selection changed before the run started');
          const authorizationRevision = (await application.events(0, session.context))
            .authorizationRevision;
          const selection =
            body.harnessId === 'deterministic' ||
            options.harnesses?.some((harness) => harness.id === body.harnessId)
              ? {}
              : providers.resolveSelection(session, {
                  harnessId: body.harnessId,
                  ...(typeof body.profileId === 'string' ? { profileId: body.profileId } : {}),
                  ...(typeof body.model === 'string' ? { model: body.model } : {}),
                });
          const context = {
            principalId: session.context.principalId,
            workspaceId: session.context.workspaceId,
            authorizationRevision,
            ...selection,
            ...(session.context.grant ? { grant: structuredClone(session.context.grant) } : {}),
            ...(captured ? { uiContext: captured } : {}),
          };
          return jsonResponse(
            await supervisor.start({ harnessId: body.harnessId, prompt: body.prompt, context }),
            202,
          );
        }
        const cancel = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/cancel$/);
        if (cancel && request.method === 'POST') {
          const run = await supervisor.get(cancel[1]!);
          if (!run || !ownsRun(run, session))
            throw new ApplicationError('NOT_FOUND', 'Run unavailable');
          await supervisor.cancel(run.id);
          return jsonResponse(await visibleRun((await supervisor.get(run.id))!, session.context));
        }
        const respond = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/respond$/);
        if (respond && request.method === 'POST') {
          const run = await supervisor.get(respond[1]!);
          if (!run || !ownsRun(run, session))
            throw new ApplicationError('NOT_FOUND', 'Run unavailable');
          if (
            run.context.authorizationRevision !==
            (await application.events(0, session.context)).authorizationRevision
          )
            throw new ApplicationError('FORBIDDEN', 'Permissions changed; start a new run');
          const body = await readJsonBody(request);
          if (typeof body.requestId !== 'string')
            throw new ApplicationError('INVALID_INPUT', 'Pending request ID required');
          if (
            body.type === 'question' &&
            typeof body.answer === 'string' &&
            body.answer.length <= 8_000
          )
            await supervisor.respondQuestion(run.id, body.requestId, body.answer);
          else if (body.type === 'approval' && typeof body.approved === 'boolean')
            await supervisor.respondApproval(run.id, body.requestId, body.approved);
          else throw new ApplicationError('INVALID_INPUT', 'Invalid question or approval response');
          return jsonResponse({ accepted: true });
        }
        return undefined;
      },
      async static(path) {
        if (!options.webRoot) return undefined;
        const name = path === '/' ? 'index.html' : path.slice(1);
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return undefined;
        const file = Bun.file(join(options.webRoot, name));
        if (!(await file.exists())) return undefined;
        return new Response(file, {
          headers: {
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store',
          },
        });
      },
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: options.port ?? 0,
      idleTimeout: 30,
      fetch: handler,
    });
    startupCleanup.unshift(() => {
      server.stop(true);
    });
    origin = `http://127.0.0.1:${server.port}`;
    await ownership.publish(origin);
    const connectionFile = join(ownership.canonicalPath, '.connection.json');
    await writeFile(
      connectionFile,
      JSON.stringify({ endpoint: origin, token: ownerSession.token }),
      { mode: 0o600 },
    );
    await chmod(connectionFile, 0o600);
    const agentConnection = options.agentConnection;
    if (agentConnection) {
      const expiresAt = agentConnection.context.grant?.expiresAt;
      const agentSession = sessions.create(
        agentConnection.context,
        expiresAt === undefined ? 30 * 86_400_000 : Math.max(0, expiresAt - Date.now()),
      );
      await writeFile(
        agentConnection.path,
        JSON.stringify({ endpoint: origin, token: agentSession.token }),
        { mode: 0o600 },
      );
      await chmod(agentConnection.path, 0o600);
      startupCleanup.unshift(() => unlink(agentConnection.path).catch(() => {}));
    }
    if (options.integration !== false) {
      integration.start(options.integration);
      lineIntegration.start(options.integration);
      for (const config of options.lineStation?.stations ?? [])
        bridges.push(
          await startStationBridge({
            application,
            workspaceId: LOCAL_WORKSPACE,
            config,
            // A failed observation pass is retried; its details stay in the host log.
            onError: (error) => console.error(`Station ${config.station}:`, error),
          }),
        );
    }
    let stopped = false;
    async function closeHost() {
      if (stopped) return;
      stopped = true;
      for (const run of await supervisor.list())
        if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.state))
          await supervisor.cancel(run.id);
      server.stop(true);
      await Promise.all(bridges.map((bridge) => bridge.stop()));
      await Promise.all([integration.stop(), lineIntegration.stop()]);
      providers.close();
      await storage.close();
      runStore.close();
      await unlink(connectionFile).catch(() => {});
      if (agentConnection) await unlink(agentConnection.path).catch(() => {});
      await security.close();
      await ownership.release();
    }
    return {
      url: origin,
      workspacePath: ownership.canonicalPath,
      connectionFile,
      instance: ownership.instance,
      launchUrl: `${origin}/#launch=${sessions.launch(ownerSession)}`,
      sessions,
      application,
      security,
      supervisor,
      integration: { ...integration, systemOfRecord },
      lineIntegration: { ...lineIntegration, mes },
      close: closeHost,
    };
  } catch (error) {
    for (const cleanup of startupCleanup)
      await Promise.resolve()
        .then(cleanup)
        .catch(() => {});
    throw error;
  }
}
