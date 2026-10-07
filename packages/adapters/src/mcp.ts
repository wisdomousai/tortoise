import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHttpTransport, type Transport } from '@agent-native/client';
import { errorEnvelope, type Catalog, type CatalogOperation } from '@agent-native/contracts';
import { readConnection } from './cli';

/** Command transport metadata is outside the domain input, so models cannot forge trusted context. */
export function toolInputSchema(operation: CatalogOperation) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      input: operation.inputSchema,
      ...(operation.kind === 'command'
        ? {
            idempotencyKey: { type: 'string', minLength: 1 },
            expectedRevisions: {
              type: 'object',
              additionalProperties: { type: 'integer', minimum: 0 },
            },
          }
        : {}),
    },
    required: operation.kind === 'command' ? ['input', 'idempotencyKey'] : ['input'],
  };
}

/** Real MCP protocol server. All tool calls attach to the same HTTP authority as the frontend. */
export function createMcpServer(client: Transport & { catalog(): Promise<Catalog> }) {
  const server = new Server(
    { name: 'agent-native-application', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const catalog = await client.catalog();
    return {
      tools: catalog.operations.map((operation) => ({
        name: operation.mcpName,
        description: operation.description || operation.id,
        inputSchema: toolInputSchema(operation),
        annotations: {
          readOnlyHint: operation.kind === 'query',
          destructiveHint: operation.kind === 'command',
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
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
      ],
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const catalog = await client.catalog();
    if (request.params.uri === 'app://contract')
      return {
        contents: [
          { uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(catalog) },
        ],
      };
    const workflow = catalog.workflows.find(
      (item) => `app://workflows/${item.id}` === request.params.uri,
    );
    if (!workflow) throw new Error('Unknown resource');
    return {
      contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: workflow.text }],
    };
  });
  return server;
}
if (import.meta.main) {
  const connection = await readConnection();
  await createMcpServer(
    createHttpTransport({ baseUrl: connection.endpoint, token: connection.token }),
  ).connect(new StdioServerTransport());
}
