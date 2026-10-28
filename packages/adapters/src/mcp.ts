import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHttpTransport, type Transport } from '@agent-native/client';
import {
  agentInstructions,
  errorEnvelope,
  expectedRevisionsSchema,
  toolEnvelopeSchema,
  workflowMarkdown,
  type Catalog,
  type CatalogAgent,
  type CatalogOperation,
} from '@agent-native/contracts';
import { readConnection } from './cli';

/** Command transport metadata is outside the domain input, so models cannot forge trusted context. */
export function toolInputSchema(operation: CatalogOperation) {
  const command = operation.kind === 'command';
  return {
    ...toolEnvelopeSchema(
      operation.inputSchema,
      command
        ? {
            idempotencyKey: { type: 'string', minLength: 1 },
            expectedRevisions: expectedRevisionsSchema,
          }
        : {},
      command ? ['input', 'idempotencyKey'] : ['input'],
    ),
    type: 'object' as const,
  };
}

type McpClient = Transport & { catalog(): Promise<Catalog> };
type CallToolRequest = { params: { name: string; arguments?: Record<string, unknown> } };

/**
 * The tool description: the capability's own, then what its display declaration says about the
 * records the result holds, so an agent knows which resource each one is and which field names it.
 */
function toolDescription(operation: CatalogOperation): string {
  const base = operation.description || operation.id;
  const display = operation.display;
  if (!display?.resource && !display?.titleField && !display?.fields) return base;
  const parts = [
    display.resource
      ? `Each record is the resource ${display.resource}:<${display.key ?? 'id'}>.`
      : '',
    display.titleField ? `${display.titleField} names a record.` : '',
    display.fields ? `Shown fields: ${display.fields.map((field) => field.name).join(', ')}.` : '',
  ];
  return `${base}\n\n${parts.filter(Boolean).join(' ')}`;
}

/** One tool per catalog operation, annotated with its kind and whether it leaves the host. */
async function listTools(client: McpClient) {
  const catalog = await client.catalog();
  return {
    tools: catalog.operations.map((operation) => ({
      name: operation.mcpName,
      ...(operation.display?.label ? { title: operation.display.label } : {}),
      description: toolDescription(operation),
      inputSchema: toolInputSchema(operation),
      annotations: {
        readOnlyHint: operation.kind === 'query',
        destructiveHint: operation.kind === 'command',
        idempotentHint: true,
        // Outbox commands reach an external system of record after the local commit; remote
        // queries read one at call time.
        openWorldHint: operation.integration !== undefined || operation.remote !== undefined,
      },
    })),
  };
}

/** Run one tool through the transport; every failure is a tool error with an error envelope. */
async function callTool(client: McpClient, request: CallToolRequest) {
  try {
    const catalog = await client.catalog();
    const operation = catalog.operations.find((item) => item.mcpName === request.params.name);
    if (!operation) throw new Error('Unknown tool');
    const args = request.params.arguments ?? {};
    if (
      Object.keys(args).some(
        (key) => !['input', 'idempotencyKey', 'expectedRevisions'].includes(key),
      )
    )
      throw new Error('Unknown tool envelope field');
    if (operation.kind === 'command' && typeof args.idempotencyKey !== 'string')
      throw new Error('Command idempotencyKey required');
    const result =
      operation.kind === 'query'
        ? await client.query(operation.id, args.input)
        : await client.command(operation.id, args.input, {
            idempotencyKey: args.idempotencyKey as string,
            expectedRevisions: args.expectedRevisions as Record<string, number> | undefined,
          });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ error: errorEnvelope(error) }) }],
    };
  }
}

/**
 * An agent definition as the agent reads it: its instructions, then the tools it may call and
 * its budgets. Text only; the host, not this resource, enforces the operations and budgets.
 */
function agentText(catalog: Catalog, agent: CatalogAgent): string {
  const tools = agent.operations.map(
    (id) => catalog.operations.find((operation) => operation.id === id)?.mcpName ?? id,
  );
  // A requesting agent's instructions list the commands it may request approval for and their inputs.
  const body =
    agent.output === 'direct' && !agent.requests?.length
      ? `${agent.instructions}\n\nYou run these commands yourself.`
      : agentInstructions(catalog, agent.id);
  return `# ${agent.title}\n\n${body}\n\nTools: ${tools.map((name) => `\`${name}\``).join(', ')}.\n\nBudgets per run: ${agent.budgets.turns} turns, ${agent.budgets.toolCalls} tool calls, ${agent.budgets.wallTimeMs / 1000} seconds.\n`;
}

/** The contract, each workflow and each agent definition, as readable resources. */
async function listResources(client: McpClient) {
  const catalog = await client.catalog();
  return {
    resources: [
      {
        uri: 'app://contract',
        name: 'Application interaction contract',
        mimeType: 'application/json',
      },
      ...catalog.workflows.map((workflow) => ({
        uri: `app://workflows/${workflow.id}`,
        name: workflow.id,
        mimeType: 'text/markdown',
      })),
      // A catalog from a host older than agent definitions has none.
      ...(catalog.agents ?? []).map((agent) => ({
        uri: `app://agents/${agent.id}`,
        name: agent.title,
        mimeType: 'text/markdown',
      })),
    ],
  };
}

async function readResource(client: McpClient, uri: string) {
  const catalog = await client.catalog();
  if (uri === 'app://contract')
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(catalog) }] };
  const agent = (catalog.agents ?? []).find((item) => `app://agents/${item.id}` === uri);
  if (agent)
    return { contents: [{ uri, mimeType: 'text/markdown', text: agentText(catalog, agent) }] };
  const workflow = catalog.workflows.find((item) => `app://workflows/${item.id}` === uri);
  if (!workflow) throw new Error('Unknown resource');
  return { contents: [{ uri, mimeType: 'text/markdown', text: workflowMarkdown(workflow) }] };
}

/** Real MCP protocol server. All tool calls attach to the same HTTP instance as the frontend. */
export function createMcpServer(client: McpClient) {
  const server = new Server(
    { name: 'agent-native-application', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => listTools(client));
  server.setRequestHandler(CallToolRequestSchema, (request) => callTool(client, request));
  server.setRequestHandler(ListResourcesRequestSchema, () => listResources(client));
  server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    readResource(client, request.params.uri),
  );
  return server;
}
if (import.meta.main) {
  const connection = await readConnection();
  await createMcpServer(
    createHttpTransport({ baseUrl: connection.endpoint, token: connection.token }),
  ).connect(new StdioServerTransport());
}
