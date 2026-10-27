import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDirectTransport } from '@agent-native/adapters/direct';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { openEmbeddedInstance } from '@agent-native/host';
import { createTestRequestsApplication } from '../application';

// The same capabilities without any screen: the starter's CLI runs the pattern in-process, and
// an MCP client lists and calls them. Nothing here loads `screens.tsx`.
const root = resolve(import.meta.dir, '../../..');
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pattern-base-headless-'));
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
      env: {
        PATH: process.env.PATH,
        AGENT_NATIVE_APPLICATION: '@agent-native/pattern-base',
      },
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

test('the CLI submits and lists test requests in-process, with no frame', async () => {
  const submitted = await cli(
    'test-request',
    'submit',
    '--specimen',
    'B-1042-03',
    '--description',
    'Hardness after heat treatment',
  );
  expect(submitted.stderr).toBe('');
  expect(submitted.exitCode).toBe(0);
  const listed = await cli('test-request', 'list');
  expect(listed.exitCode).toBe(0);
  expect(JSON.parse(listed.stdout).data).toMatchObject({
    total: 1,
    items: [{ specimen: 'B-1042-03', requester: 'owner' }],
  });
  expect(
    (await cli('test-request', 'submit', '--specimen', 'x'.repeat(65), '--description', ''))
      .exitCode,
  ).toBe(2);
});

test('an MCP client sees one titled tool per capability and the workflow text', async () => {
  const instance = await openEmbeddedInstance(createTestRequestsApplication(), {
    workspacePath: join(directory, 'mcp'),
  });
  const server = createMcpServer(
    createDirectTransport(instance.application, { workspaceId: 'local', principalId: 'owner' }),
  );
  const mcp = new Client({ name: 'pattern-base', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'test_request_get',
      'test_request_list',
      'test_request_submit',
      'test_request_update',
    ]);
    // The display declaration gives each tool a title and says which resource a record is.
    const list = tools.find((tool) => tool.name === 'test_request_list')!;
    expect(list.title).toBe('Test requests');
    expect(list.description).toContain(
      'Each record is the resource test-request:<id>. specimen names a record.',
    );
    expect(tools.find((tool) => tool.name === 'test_request_submit')!.title).toBe(
      'Submit test request',
    );
    const workflow = await mcp.readResource({ uri: 'app://workflows/test-requests.assign-method' });
    expect(JSON.stringify(workflow.contents)).toContain('expectedRevisions');
    const called = await mcp.callTool({
      name: 'test_request_submit',
      arguments: {
        input: { specimen: 'B-1042-04', description: 'Salt spray, 96 h' },
        idempotencyKey: 'mcp-1',
      },
    });
    expect(called.isError).toBeFalsy();
  } finally {
    await mcp.close();
    await instance.close();
  }
});
