import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import { createPartsDeskApplication } from '../application';

test('the screen, HTTP, the CLI and MCP read the same inquiry list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'parts-desk-conformance-'));
  const host = await startHost(createPartsDeskApplication(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'owner-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const server = createMcpServer(owner);
  const mcp = new Client({ name: 'parts-desk-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const utility = await owner.command('customer.create', {
      account: 'U1042',
      name: 'Stadtwerke Nordhafen',
      phone: '+49 40 5550 1042',
    });
    await owner.command('inquiry.create', {
      caller: 'J. Weber',
      customerId: (utility.result as { id: string }).id,
      subject: 'From HTTP',
    });
    const direct = await host.application.queryRaw(
      { operation: 'inquiry.list', input: {} },
      { workspaceId: 'local', principalId: 'owner' },
    );
    expect(direct.data).toMatchObject({ total: 1, items: [{ subject: 'From HTTP' }] });
    expect((await owner.query('inquiry.list', {})).data).toEqual(direct.data);
    const child = Bun.spawn(
      [
        process.execPath,
        Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir),
        'inquiry.list',
      ],
      { env: { PATH: process.env.PATH, TORTOISE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toEqual(direct.data);
    const response = await mcp.callTool({ name: 'inquiry_list', arguments: { input: {} } });
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
