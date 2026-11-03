import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { startHost } from '@agent-native/host/host';
import { createToolStoreApplication } from '../application';

test('the screen, HTTP, the CLI and MCP read the same tool list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tool-store-conformance-'));
  const host = await startHost(createToolStoreApplication(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'owner-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const server = createMcpServer(owner);
  const mcp = new Client({ name: 'tool-store-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    await owner.command('tool.create', {
      assetTag: 'TC-00601',
      description: 'From HTTP',
      category: 'gauge',
      bin: 'A-03',
    });
    const direct = await host.application.queryRaw(
      { operation: 'tool.list', input: {} },
      { workspaceId: 'local', principalId: 'owner' },
    );
    expect(direct.data).toMatchObject({
      total: 1,
      items: [{ assetTag: 'TC-00601', description: 'From HTTP', status: 'available' }],
    });
    expect((await owner.query('tool.list', {})).data).toEqual(direct.data);
    const child = Bun.spawn(
      [
        process.execPath,
        Bun.resolveSync('@agent-native/adapters/cli', import.meta.dir),
        'tool.list',
      ],
      { env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toEqual(direct.data);
    const response = await mcp.callTool({ name: 'tool_list', arguments: { input: {} } });
    const decoded =
      response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
    expect((decoded as { data: unknown }).data).toEqual(direct.data);
  } finally {
    await mcp.close();
    await server.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
