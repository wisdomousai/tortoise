import { expect, test } from 'bun:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  buildCatalog,
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { createMcpServer } from './mcp';

const catalog = buildCatalog([
  defineModule({
    id: 'lots',
    capabilities: [
      defineCapability({
        id: 'lot.list',
        kind: 'query',
        input: jsonSchema(z.strictObject({})),
        output: jsonSchema(z.strictObject({})),
        permission: { action: 'read', resourceType: 'Lot' },
        ui: { binding: 'lot.list' },
      }),
    ],
    agents: [
      defineAgent({
        id: 'lot.advisor',
        title: 'Lot advisor',
        instructions: 'Suggest which lots to release.',
        operations: ['lot.list'],
        model: 'any',
        output: 'propose',
        budgets: { turns: 4, toolCalls: 10, wallTimeMs: 30_000 },
      }),
    ],
  }),
]);

test('each agent definition is a readable MCP resource with its tools and budgets', async () => {
  const unused = () => Promise.reject(new Error('not called'));
  const server = createMcpServer({
    catalog: async () => catalog,
    query: unused,
    command: unused,
    events: () => ({ [Symbol.asyncIterator]: () => ({ next: unused }) }),
  });
  const client = new Client({ name: 'agents-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain('app://agents/lot.advisor');
    const read = await client.readResource({ uri: 'app://agents/lot.advisor' });
    const text = (read.contents[0] as { text: string }).text;
    expect(text).toContain('# Lot advisor');
    expect(text).toContain('Suggest which lots to release.');
    expect(text).toContain('recorded as proposals');
    expect(text).toContain('Tools: `lot_list`.');
    expect(text).toContain('4 turns, 10 tool calls, 30 seconds');
  } finally {
    await client.close();
    await server.close();
  }
});
