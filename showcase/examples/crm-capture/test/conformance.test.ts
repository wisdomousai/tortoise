import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { startHost } from '@agent-native/host/host';
import { createCrmCaptureApplication } from '../application';
import { FakeCrm } from '../fake-crm';

/** Remote results carry their fetch time; everything else must match exactly. */
const withoutFetchTime = (data: { items: unknown[]; source: { fetchedAt: number } }) => {
  const { fetchedAt, ...source } = data.source;
  expect(fetchedAt).toBeGreaterThan(0);
  return { items: data.items, source };
};

test('one provider answers the screen, HTTP, the CLI and MCP with the same result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-crm-'));
  const crm = new FakeCrm({ logins: { owner: 'ann' } });
  const host = await startHost(createCrmCaptureApplication({ crm }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'owner-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const cli = async (args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@agent-native/adapters/cli', import.meta.dir), ...args],
      { env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { exitCode, value: JSON.parse(stdout) };
  };
  const server = createMcpServer(owner);
  const mcp = new Client({ name: 'crm-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const input = { q: 'acme' };
    const direct = await host.application.queryRaw(
      { operation: 'crm.account.search', input },
      { workspaceId: 'local', principalId: 'owner' },
    );
    const http = await owner.query('crm.account.search', input);
    const commandLine = await cli(['crm.account.search', '--json', JSON.stringify(input)]);
    const tool = decode(await mcp.callTool({ name: 'crm_account_search', arguments: { input } }));
    const expected = withoutFetchTime(direct.data as never);
    expect(expected.items).toHaveLength(2);
    expect(withoutFetchTime(http.data as never)).toEqual(expected);
    expect(commandLine.exitCode).toBe(0);
    expect(withoutFetchTime(commandLine.value.data)).toEqual(expected);
    expect(withoutFetchTime(tool.data)).toEqual(expected);

    // Paging is part of the contract: a cursor from one surface continues on another.
    const page1 = await owner.query<{ next?: string }>('crm.account.search', { q: '' });
    const page2 = { q: '', cursor: page1.data.next };
    const viaHttp = await owner.query('crm.account.search', page2);
    const viaTool = decode(
      await mcp.callTool({ name: 'crm_account_search', arguments: { input: page2 } }),
    );
    expect(withoutFetchTime(viaTool.data)).toEqual(withoutFetchTime(viaHttp.data as never));
    expect(withoutFetchTime(viaTool.data).items).toHaveLength(2);

    // Agents learn from tool metadata that the search reads another system and changes nothing.
    const tools = (await mcp.listTools()).tools;
    const search = tools.find((candidate) => candidate.name === 'crm_account_search');
    expect(search?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(search?.description).toContain('live');
    expect(
      tools.find((candidate) => candidate.name === 'crm_account_list')?.annotations?.openWorldHint,
    ).toBe(false);

    // The same adopt flow over MCP: a tool call commits locally, the CRM confirms it later.
    const adopted = decode(
      await mcp.callTool({
        name: 'crm_account_adopt',
        arguments: { input: { externalId: '001A1' }, idempotencyKey: 'adopt-mcp' },
      }),
    );
    expect(adopted.result).toEqual({ id: '001A1', status: 'following' });
    await host.integrations.target('crm').dispatcher.runOnce();
    await host.integrations.sync();
    const list = await owner.query<{ items: { id: string; status: string }[] }>(
      'crm.account.list',
      {},
    );
    expect(list.data.items).toMatchObject([{ id: '001A1', status: 'adopted' }]);
  } finally {
    await mcp.close();
    await server.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
