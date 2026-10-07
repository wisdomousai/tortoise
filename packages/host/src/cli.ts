import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHttpTransport } from '@agent-native/client';
import { ApplicationError, errorEnvelope } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import {
  PENDING_EXIT_CODE,
  exitCodes,
  readConnection,
  runCliMain,
  takeFlag,
  type CliClient,
} from '@agent-native/adapters/cli';
import { createDirectTransport, readGrantFile } from '@agent-native/adapters/direct';
import { createMcpServer } from '@agent-native/adapters/mcp';
import type { AnyApplicationDefinition } from './application';
import {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openEmbeddedAuthority,
  type EmbeddedAuthority,
} from './embedded';
import { deploymentCatalog } from './components';
import { assertIdentity, securityFromEnvironment, type SecurityOptions } from './security';
import { assuranceCommand, assuranceUsage } from './assurance-cli';

const OWNER: ExecutionContext = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };

const authorityUsage = (program: string) => `Authority:
  ${program} serve [--workspace dir] [--port n] [--web-root dir] [--grant-file f --grant-connection out]
  ${program} mcp [--connection file] | mcp --embedded --grant-file f [--workspace dir]
  ${program} sync [--workspace dir]               pull master data from the system of record once
  ${program} drain [--workspace dir] [--timeout ms]  deliver pending effects; exit ${PENDING_EXIT_CODE} if any remain

Security (serve, mcp --embedded, sync, drain and --embedded operations):
  --site-policy file   bind declared destinations (AGENT_NATIVE_SITE_POLICY); absent: isolated
  --audit-log dir      audit event log directory (AGENT_NATIVE_AUDIT_LOG); default <workspace>/audit

Operations run against a live authority (--connection or AGENT_NATIVE_CONNECTION), or in-process
with --embedded [--workspace dir] [--grant-file f]. help, list, schema and workflows work offline.
`;

const workspaceOf = (args: string[]) =>
  resolve(takeFlag(args, 'workspace') ?? process.env.WORKSPACE_PATH ?? '.workspace');

/** Trusted launcher configuration: where the site policy and audit log are. */
const securityOf = (args: string[]): SecurityOptions =>
  securityFromEnvironment(process.env, {
    sitePolicy: takeFlag(args, 'site-policy'),
    eventLogDirectory: takeFlag(args, 'audit-log'),
  });

function finite(value: string | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0)
    throw new ApplicationError('INVALID_INPUT', `--${name} must be a non-negative integer`);
  return number;
}

function rejectRemaining(args: string[]) {
  if (args.length) throw new ApplicationError('INVALID_INPUT', `Unexpected argument "${args[0]}"`);
}

/** Print one JSON value; diagnostics go to stderr so stdout stays machine-readable. */
function report(value: unknown) {
  console.log(JSON.stringify(value));
}

/**
 * The command line for one application, compiled into one binary by `bun run build:cli`.
 * Returns `main(argv)`, which resolves to the process exit code and never throws: failures are
 * printed as a JSON error envelope with the matching exit code.
 *
 * Trust boundary: identity comes from the launcher, never from operation arguments. Attached
 * calls use the session in a connection file written by the authority. Embedded calls use a
 * grant file prepared by the orchestrator; without one, an embedded call acts as the local
 * workspace owner, which is only appropriate for a human operator on their own machine.
 */
export function createCli(definition: AnyApplicationDefinition, options: { program: string }) {
  const { program } = options;
  async function withEmbedded<T>(
    workspacePath: string,
    security: SecurityOptions,
    use: (authority: EmbeddedAuthority) => Promise<T>,
  ): Promise<T> {
    const authority = await openEmbeddedAuthority(definition, { workspacePath, security });
    try {
      return await use(authority);
    } finally {
      await authority.close();
    }
  }

  async function serveCommand(args: string[]) {
    const workspacePath = workspaceOf(args);
    const security = securityOf(args);
    const port = finite(takeFlag(args, 'port'), 4317, 'port');
    const webRoot = takeFlag(args, 'web-root');
    const grantFile = takeFlag(args, 'grant-file');
    const grantConnection = takeFlag(args, 'grant-connection');
    rejectRemaining(args);
    if (!grantFile !== !grantConnection)
      throw new ApplicationError(
        'INVALID_INPUT',
        '--grant-file and --grant-connection are used together',
      );
    // Loaded lazily: provider access and the web host are not needed by embedded commands.
    const { serve } = await import('./serve');
    await serve(definition, {
      workspacePath,
      port,
      ...(webRoot ? { webRoot: resolve(webRoot) } : {}),
      runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
      security,
      ...(grantFile
        ? {
            agentConnection: {
              context: await readGrantFile(grantFile, LOCAL_WORKSPACE),
              path: resolve(grantConnection!),
            },
          }
        : {}),
    });
    return new Promise<number>(() => {});
  }

  async function mcpCommand(args: string[]) {
    const embedded = takeFlag(args, 'embedded', false) !== undefined;
    if (!embedded) {
      const connection = await readConnection(takeFlag(args, 'connection'));
      rejectRemaining(args);
      await createMcpServer(
        createHttpTransport({ baseUrl: connection.endpoint, token: connection.token }),
      ).connect(new StdioServerTransport());
      return new Promise<number>(() => {});
    }
    const workspacePath = workspaceOf(args);
    const security = securityOf(args);
    const grantFile = takeFlag(args, 'grant-file') ?? process.env.AGENT_NATIVE_GRANT_FILE;
    rejectRemaining(args);
    // MCP is the agent surface, so an embedded server always runs under an explicit delegation.
    if (!grantFile)
      throw new ApplicationError('INVALID_INPUT', 'mcp --embedded requires --grant-file');
    const context: ExecutionContext = {
      ...(await readGrantFile(grantFile, LOCAL_WORKSPACE)),
      channel: 'mcp',
    };
    const authority = await openEmbeddedAuthority(definition, { workspacePath, security });
    try {
      assertIdentity(authority.security.policy, context);
    } catch (error) {
      await authority.close();
      throw error;
    }
    // Load master data before the first tool call so the worklist is not empty on a fresh sandbox.
    // An unreachable system of record must not block capture; the background loop retries.
    await authority.integrations.sync().catch((error) => {
      process.stderr.write(`Initial master-data sync failed: ${errorEnvelope(error).message}\n`);
    });
    authority.integrations.start();
    const server = createMcpServer(createDirectTransport(authority.application, context));
    let closing: Promise<void> | undefined;
    const shutdown = () => {
      // Pending effects stay committed in the workspace; `drain` or the next start delivers them.
      closing ??= server
        .close()
        .catch(() => undefined)
        .then(() => authority.close())
        .then(() => process.exit(0));
      return closing;
    };
    process.stdin.on('end', () => void shutdown());
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
    await server.connect(new StdioServerTransport());
    return new Promise<number>(() => {});
  }

  async function drainCommand(args: string[]) {
    const workspacePath = workspaceOf(args);
    const security = securityOf(args);
    const timeout = finite(takeFlag(args, 'timeout'), 30_000, 'timeout');
    rejectRemaining(args);
    return withEmbedded(workspacePath, security, async ({ integrations }) => {
      // Pending counts every target in the outbox, including ones this process cannot deliver.
      const backlog = await integrations.drain(timeout);
      report(backlog);
      return backlog.pending ? PENDING_EXIT_CODE : 0;
    });
  }

  async function syncCommand(args: string[]) {
    const workspacePath = workspaceOf(args);
    const security = securityOf(args);
    rejectRemaining(args);
    return withEmbedded(workspacePath, security, async ({ integrations }) => {
      report(await integrations.sync());
      return 0;
    });
  }

  const offlineVerbs = new Set(['help', 'list', 'schema', 'workflows']);

  /** The published contract, for discovery without any authority. Executing is refused. */
  function offlineClient(): CliClient {
    const catalog = deploymentCatalog(definition.manifest);
    const unavailable = () => {
      throw new ApplicationError(
        'INVALID_INPUT',
        'No authority: pass --embedded or --connection, or set AGENT_NATIVE_CONNECTION',
      );
    };
    return {
      catalog: async () => catalog,
      query: unavailable,
      command: unavailable,
      events: unavailable,
    };
  }

  async function operationCommand(args: string[]) {
    const embedded = takeFlag(args, 'embedded', false) !== undefined;
    const connection = takeFlag(args, 'connection');
    const explicitGrant = takeFlag(args, 'grant-file');
    const grantFile = explicitGrant ?? process.env.AGENT_NATIVE_GRANT_FILE;
    if (!embedded) {
      // An attached call's identity is the connection file's session; a grant cannot apply.
      if (explicitGrant)
        throw new ApplicationError('INVALID_INPUT', '--grant-file applies to --embedded calls');
      const offline =
        !connection &&
        !process.env.AGENT_NATIVE_CONNECTION &&
        (args.length === 0 || offlineVerbs.has(args[0]!) || args.includes('--help'));
      return runCliMain(
        args,
        offline
          ? offlineClient()
          : async () => {
              const file = await readConnection(connection).catch((error: Error) => {
                throw new ApplicationError('INVALID_INPUT', error.message);
              });
              return createHttpTransport({ baseUrl: file.endpoint, token: file.token });
            },
        { program },
      );
    }
    const workspacePath = workspaceOf(args);
    const security = securityOf(args);
    let authority: EmbeddedAuthority | undefined;
    try {
      return await runCliMain(
        args,
        async () => {
          const context: ExecutionContext = {
            ...(grantFile ? await readGrantFile(grantFile, LOCAL_WORKSPACE) : OWNER),
            channel: 'cli',
          };
          authority = await openEmbeddedAuthority(definition, { workspacePath, security });
          // The local owner acts only where the site policy trusts it; otherwise a grant is required.
          assertIdentity(authority.security.policy, context);
          // Commits stay in the workspace outbox; `drain`, `mcp --embedded` or `serve` deliver them.
          return createDirectTransport(authority.application, context);
        },
        { program },
      );
    } finally {
      await authority?.close();
    }
  }

  return async function main(argv: readonly string[]): Promise<number> {
    const args = [...argv];
    const verb = args[0];
    try {
      if (verb === 'serve') return await serveCommand(args.slice(1));
      if (verb === 'mcp') return await mcpCommand(args.slice(1));
      if (verb === 'drain') return await drainCommand(args.slice(1));
      if (verb === 'sync') return await syncCommand(args.slice(1));
      // Touching no workspace: policy checks, rule export, log audit.
      const assurance = await assuranceCommand(definition.manifest, args);
      if (assurance !== undefined) return assurance;
      if (verb === undefined || (verb === 'help' && args.length === 1) || verb === '--help') {
        process.stdout.write(authorityUsage(program) + '\n' + assuranceUsage(program) + '\n');
        return await operationCommand(['help']);
      }
      return await operationCommand(args);
    } catch (error) {
      const envelope = errorEnvelope(error);
      report({ error: envelope });
      return exitCodes[envelope.code];
    }
  };
}
