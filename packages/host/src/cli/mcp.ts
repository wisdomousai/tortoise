import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConnection, takeFlag } from '@tortoise/adapters/cli';
import { createDirectTransport, readGrantFile } from '@tortoise/adapters/direct';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { createHttpTransport } from '@tortoise/client';
import { ApplicationError, errorEnvelope } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import type { AnyApplicationDefinition } from '../application';
import { LOCAL_WORKSPACE, openEmbeddedInstance } from '../embedded';
import { rejectRemaining, settingsOf, workspaceOf } from './args';

/** An MCP server over stdio for an instance that is already running. */
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
  const settings = settingsOf(definition.manifest, args);
  const grantFile = takeFlag(args, 'grant-file') ?? process.env.AGENT_NATIVE_GRANT_FILE;
  rejectRemaining(args);
  // MCP is the agent surface, so an embedded server always runs under an explicit delegation.
  if (!grantFile)
    throw new ApplicationError('INVALID_INPUT', 'mcp --embedded requires --grant-file');
  const context: ExecutionContext = {
    ...(await readGrantFile(grantFile, LOCAL_WORKSPACE)),
    channel: 'mcp',
  };
  const instance = await openEmbeddedInstance(definition, { workspacePath, settings });
  try {
    instance.ports.identity.admit(context);
  } catch (error) {
    await instance.close();
    throw error;
  }
  // Load master data before the first tool call so the worklist is not empty on a fresh sandbox.
  // An unreachable system of record must not block capture; the background loop retries.
  await instance.integrations.sync().catch((error) => {
    process.stderr.write(`Initial master-data sync failed: ${errorEnvelope(error).message}\n`);
  });
  instance.integrations.start();
  const server = createMcpServer(createDirectTransport(instance.application, context));
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    // Pending effects stay committed in the workspace; `drain` or the next start delivers them.
    closing ??= server
      .close()
      .catch(() => undefined)
      .then(() => instance.close())
      .then(() => process.exit(0));
    return closing;
  };
  process.stdin.on('end', () => void shutdown());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
  await server.connect(new StdioServerTransport());
  return new Promise<number>(() => {});
}

/** `mcp`: attached to a live instance, or `--embedded` in-process. */
export async function mcpCommand(definition: AnyApplicationDefinition, args: string[]) {
  const embedded = takeFlag(args, 'embedded', false) !== undefined;
  return embedded ? embeddedMcp(definition, args) : attachedMcp(args);
}
