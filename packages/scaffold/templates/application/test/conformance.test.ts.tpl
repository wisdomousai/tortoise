import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import { create{{app.pascal}}Application } from '../application';

test('the screen, HTTP, the CLI and MCP read the same {{one.words}} list', async () => {
  const directory = await mkdtemp(join(tmpdir(), '{{app.kebab}}-conformance-'));
  const host = await startHost(create{{app.pascal}}Application(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const localUser = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'local-user-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const server = createMcpServer(localUser);
  const mcp = new Client({ name: '{{app.kebab}}-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    await localUser.command('{{one.kebab}}.create', { title: 'From HTTP' });
    const direct = await host.application.queryRaw(
      { operation: '{{one.kebab}}.list', input: {} },
      { workspaceId: 'local', principalId: 'local-user' },
    );
    expect(direct.data).toMatchObject({ total: 1, items: [{ title: 'From HTTP' }] });
    expect((await localUser.query('{{one.kebab}}.list', {})).data).toEqual(direct.data);
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir), '{{one.kebab}}.list'],
      { env: { PATH: process.env.PATH, TORTOISE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toEqual(direct.data);
    const response = await mcp.callTool({ name: '{{tool}}', arguments: { input: {} } });
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
