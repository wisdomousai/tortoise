import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import { createReceivingApplication } from '../application';

test('a count over HTTP, then the instance, HTTP, the CLI and MCP read the same delivery list', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'receiving-conformance-'));
  // The ERP's notice export reaches the host through the inbox folder the site policy binds.
  const inbox = join(directory, 'asn');
  await mkdir(inbox);
  await writeFile(
    join(inbox, 'asn-1.csv'),
    'id,purchaseOrder,supplier,sku,description,expected\nASN-1-1,PO-1,Acme,M8,Bolt,10\n',
  );
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      folders: { 'erp-asn': { path: inbox } },
    }),
  );
  const host = await startHost(createReceivingApplication({ quietMs: 0 }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'site-policy': policy },
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'owner-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const server = createMcpServer(owner);
  const mcp = new Client({ name: 'receiving-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    // The ERP's notices only: quality inspection is not connected here.
    await host.integrations.target('erp').inbound.runOnce();
    await owner.command('delivery.receive', { id: 'ASN-1-1', counted: 9 });
    const direct = await host.application.queryRaw(
      { operation: 'delivery.list', input: {} },
      { workspaceId: 'local', principalId: 'owner' },
    );
    expect(direct.data).toMatchObject({ total: 1, items: [{ id: 'ASN-1-1', counted: 9 }] });
    expect((await owner.query('delivery.list', {})).data).toEqual(direct.data);
    const child = Bun.spawn(
      [
        process.execPath,
        Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir),
        'delivery.list',
      ],
      { env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data).toEqual(direct.data);
    const response = await mcp.callTool({ name: 'delivery_list', arguments: { input: {} } });
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
