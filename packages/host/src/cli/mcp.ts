import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConnection, takeFlag } from '@agent-native/adapters/cli';
import { createDirectTransport, readGrantFile } from '@agent-native/adapters/direct';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { createHttpTransport } from '@agent-native/client';
import { ApplicationError, errorEnvelope } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { AnyApplicationDefinition } from '../application';
import { LOCAL_WORKSPACE, openEmbeddedAuthority } from '../embedded';
import { assertIdentity } from '../security';
import { rejectRemaining, securityOf, workspaceOf } from './args';

/** An MCP server over stdio for an authority that is already running. */
async function attachedMcp(args: string[]) {
  const connection = await readConnection(takeFlag(args, 'connection'));
  rejectRemaining(args);
  await createMcpServer(
    createHttpTransport({ baseUrl: connection.endpoint, token: connection.token }),
  ).connect(new StdioServerTransport());
  return new Promise<number>(() => {});
}

/** An MCP server over stdio that opens the workspace itself, under an explicit delegation. */
async function embeddedMcp(definition: AnyApplicationDefinition, args: string[]) {
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

/** `mcp`: attached to a live authority, or `--embedded` in-process. */
export async function mcpCommand(definition: AnyApplicationDefinition, args: string[]) {
  const embedded = takeFlag(args, 'embedded', false) !== undefined;
  return embedded ? embeddedMcp(definition, args) : attachedMcp(args);
}
