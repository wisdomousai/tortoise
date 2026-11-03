import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { startHost } from '@agent-native/host/host';
import { createToolStoreApplication } from '../application';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** A host with a fixed clock and an MCP client that calls it over HTTP as the owner, an attendant. */
async function connect() {
  const directory = await mkdtemp(join(tmpdir(), 'tool-store-calibration-mcp-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost(createToolStoreApplication({ services: { now: () => NOW } }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  cleanup.push(() => host.close());
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const server = createMcpServer(createHttpTransport({ baseUrl: host.url, token }));
  const mcp = new Client({ name: 'tool-store-calibration', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  cleanup.push(() => server.close());
  cleanup.push(() => mcp.close());
  return mcp;
}
type Mcp = Awaited<ReturnType<typeof connect>>;

/** Call a tool and decode its JSON content; an error result decodes to its error envelope. */
async function call(mcp: Mcp, name: string, args: Record<string, unknown>) {
  const response = await mcp.callTool({ name, arguments: args });
  const body = JSON.parse((response.content as { text: string }[])[0]!.text) as Record<
    string,
    unknown
  >;
  return { isError: response.isError === true, body };
}

test('MCP lists tool.calibration-due and the calibration-pull workflow by operation ID', async () => {
  const mcp = await connect();
  const { tools } = await mcp.listTools();
  const due = tools.find((tool) => tool.name === 'tool_calibration_due');
  expect(due?.annotations?.readOnlyHint).toBe(true);
  expect(due?.description).toContain('on or before today plus days, soonest first');
  const input = (due?.inputSchema.properties as { input: { properties: object } }).input;
  expect(Object.keys(input.properties).sort()).toEqual(['days', 'limit', 'offset']);

  // Every tool command tells a model who may call it; each one that changes a tool, how a stale revision ends.
  const commands = tools.filter(
    (tool) => tool.name.startsWith('tool_') && tool.annotations?.readOnlyHint === false,
  );
  expect(commands.map((tool) => tool.name).sort()).toEqual([
    'tool_check_out',
    'tool_create',
    'tool_mark_found',
    'tool_mark_missing',
    'tool_retire',
    'tool_return',
    'tool_update',
  ]);
  for (const tool of commands) {
    expect(tool.description).toContain('Attendants only. A viewer is refused with FORBIDDEN.');
    if (tool.name !== 'tool_create')
      expect(tool.description).toContain(
        'A stale revision is refused with CONFLICT and nothing changes.',
      );
  }

  const { resources } = await mcp.listResources();
  expect(resources).toContainEqual(
    expect.objectContaining({ uri: 'app://workflows/calibration-pull', name: 'calibration-pull' }),
  );
  const read = await mcp.readResource({ uri: 'app://workflows/calibration-pull' });
  const text = (read.contents[0] as { text: string }).text;
  for (const id of ['tool.calibration-due', 'tool.get', 'tool.update']) expect(text).toContain(id);
  expect(text).toContain('CAL-01');
  // The text names operation IDs, never this transport's tool names.
  expect(text).not.toMatch(/tool_[a-z]/);
});

test('tool.update over MCP commits with the revision tool.get returned and refuses a stale one', async () => {
  const mcp = await connect();
  const created = await call(mcp, 'tool_create', {
    input: {
      assetTag: 'TC-00601',
      description: 'Torque wrench 20-100 Nm',
      category: 'torque-tool',
      bin: 'A-03',
      calibrationDue: '2026-11-10',
    },
    idempotencyKey: 'create-wrench',
  });
  expect(created.isError).toBe(false);

  const due = await call(mcp, 'tool_calibration_due', { input: {} });
  const listed = (due.body.data as { items: { id: string; assetTag: string }[] }).items;
  expect(listed).toMatchObject([{ assetTag: 'TC-00601' }]);
  const id = listed[0]!.id;

  const read = await call(mcp, 'tool_get', { input: { id } });
  const { revision } = read.body.data as { revision: number };
  expect(revision).toBeGreaterThan(0);

  const moved = await call(mcp, 'tool_update', {
    input: { id, bin: 'CAL-01' },
    idempotencyKey: 'pull-wrench',
    expectedRevisions: { [`tool:${id}`]: revision },
  });
  expect(moved.isError).toBe(false);
  expect(moved.body).toMatchObject({ result: { bin: 'CAL-01' } });
  expect((moved.body.revisions as Record<string, number>)[`tool:${id}`]).toBe(revision + 1);

  // The same revision again is stale now: CONFLICT, and the tool keeps the bin it has.
  const stale = await call(mcp, 'tool_update', {
    input: { id, bin: 'A-03' },
    idempotencyKey: 'stale-wrench',
    expectedRevisions: { [`tool:${id}`]: revision },
  });
  expect(stale.isError).toBe(true);
  expect(stale.body).toMatchObject({ error: { code: 'CONFLICT' } });
  const after = await call(mcp, 'tool_get', { input: { id } });
  expect(after.body.data).toMatchObject({ bin: 'CAL-01', revision: revision + 1 });
});
