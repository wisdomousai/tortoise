import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDirectTransport } from '@agent-native/adapters/direct';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { openEmbeddedInstance } from '@agent-native/host';
import { createNotesApplication } from '../application';

// The same capabilities without any screen: the starter's CLI runs the sample in-process, and
// an MCP client lists and calls them. Nothing here loads `screens.tsx`.
const root = resolve(import.meta.dir, '../../..');
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sample-notes-headless-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function cli(...args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      join(root, 'apps/service/src/cli.ts'),
      ...args,
      '--embedded',
      '--workspace',
      join(directory, 'cli'),
    ],
    {
      cwd: root,
      env: { PATH: process.env.PATH, AGENT_NATIVE_APPLICATION: '@agent-native/sample-notes' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test('the CLI adds and lists notes in-process, with no frame', async () => {
  const added = await cli('note', 'add', '--title', 'Pump P-2', '--text', 'Seal leaking');
  expect(added.stderr).toBe('');
  expect(added.exitCode).toBe(0);
  const listed = await cli('note', 'list');
  expect(listed.exitCode).toBe(0);
  expect(JSON.parse(listed.stdout).data).toMatchObject({
    total: 1,
    items: [{ title: 'Pump P-2', author: 'owner' }],
  });
  expect((await cli('note', 'add', '--title', 'x'.repeat(201), '--text', '')).exitCode).toBe(2);
});

test('an MCP client sees one tool per capability and the workflow text', async () => {
  const instance = await openEmbeddedInstance(createNotesApplication(), {
    workspacePath: join(directory, 'mcp'),
  });
  const server = createMcpServer(
    createDirectTransport(instance.application, { workspaceId: 'local', principalId: 'owner' }),
  );
  const mcp = new Client({ name: 'sample-notes', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'note_add',
      'note_get',
      'note_list',
      'note_update',
    ]);
    const workflow = await mcp.readResource({ uri: 'app://workflows/notes.edit' });
    expect(JSON.stringify(workflow.contents)).toContain('expectedRevisions');
    const called = await mcp.callTool({
      name: 'note_add',
      arguments: { input: { title: 'From MCP', text: '' }, idempotencyKey: 'mcp-1' },
    });
    expect(called.isError).toBeFalsy();
  } finally {
    await mcp.close();
    await instance.close();
  }
});
