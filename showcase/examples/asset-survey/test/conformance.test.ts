import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { enrollPath } from '@agent-native/device-link/contracts';
import { startHost } from '@agent-native/host/host';
import { createAssetSurveyApplication } from '../application';
import { nameplatePhoto } from '../connectors/nameplate-photo';

test('a paired device hands over a capture over HTTP, and every surface reads it alike', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-survey-'));
  const host = await startHost(createAssetSurveyApplication(), {
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
  const mcp = new Client({ name: 'survey-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  let key = 0;
  const command = async <T>(operation: string, input: unknown) =>
    (await owner.command<T>(operation, input, { idempotencyKey: `k${++key}` })).result;
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);

    const g1 = await command<{ id: string }>('structure.node.create', {
      scheme: 'iec81346',
      designation: '=G1',
      name: 'Generator 1',
    });
    const q1 = await command<{ id: string }>('structure.node.create', {
      parentId: g1.id,
      scheme: 'iec81346',
      designation: '=G1-Q1',
      name: 'Generator circuit breaker',
    });
    const assignment = await command<{ id: string }>('assignment.survey.create', {
      title: 'Nameplates of =G1',
      scope: { roots: [g1.id], kinds: ['nameplate'] },
    });

    // Pairing: the hub issues a code, the device redeems it for its own bearer token.
    const { code } = await command<{ code: string }>('link.enrollment.create', {
      label: 'Phone',
      kind: 'field-sync',
    });
    const redeemed = await fetch(host.url + enrollPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(redeemed.status).toBe(201);
    const paired = (await redeemed.json()) as { token: string; device: { id: string } };
    await command('assignment.survey.send', {
      id: assignment.id,
      assignee: { type: 'device', id: paired.device.id },
    });

    const device = (path: string, body: BodyInit, contentType = 'application/json') =>
      fetch(host.url + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${paired.token}`, 'Content-Type': contentType },
        body,
      });
    const feed = await device('/api/v1/queries/assignment.feed', JSON.stringify({ input: {} }));
    expect(feed.status).toBe(200);
    expect(
      ((await feed.json()) as { data: { items: { brief: { nodes: unknown[] } }[] } }).data.items[0]!
        .brief.nodes,
    ).toHaveLength(2);
    const upload = await device(
      '/api/v1/blobs',
      nameplatePhoto({ manufacturer: 'ABB' }) as Uint8Array<ArrayBuffer>,
      'image/png',
    );
    expect(upload.status).toBe(201);
    const photo = await upload.json();
    const body = {
      kind: 'nameplate',
      photos: [photo],
      codes: ['=G1-Q1'],
      note: 'Behind the left door',
      takenAt: 1_700_000_000_000,
    };
    const report = await device(
      '/api/v1/commands/assignment.survey.report',
      JSON.stringify({
        input: { id: 'cap-1', assignmentId: assignment.id, subject: q1.id, body },
        idempotencyKey: 'cap-1',
      }),
    );
    expect(report.status).toBe(200);
    // The device's token reaches its sync operations and nothing else.
    expect(
      (await device('/api/v1/queries/structure.tree', JSON.stringify({ input: {} }))).status,
    ).toBe(403);

    const input = { id: 'cap-1' };
    const direct = await host.application.queryRaw(
      { operation: 'capture.get', input },
      { workspaceId: 'local', principalId: 'owner' },
    );
    expect(direct.data).toMatchObject({
      ...body,
      id: 'cap-1',
      assignmentId: assignment.id,
      nodeId: q1.id,
      reportedBy: `device:${paired.device.id}`,
      review: 'new',
    });
    expect((await owner.query('capture.get', input)).data).toEqual(direct.data);
    const commandLine = await cli(['capture.get', '--json', JSON.stringify(input)]);
    expect(commandLine.exitCode).toBe(0);
    expect(commandLine.value.data).toEqual(direct.data);
    expect(decode(await mcp.callTool({ name: 'capture_get', arguments: { input } })).data).toEqual(
      direct.data,
    );

    // The photo is readable through the capture that references it.
    const download = await fetch(`${host.url}/api/v1/blobs/${photo.digest}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(
      nameplatePhoto({ manufacturer: 'ABB' }) as Uint8Array<ArrayBuffer>,
    );

    // Agents see that filing reaches another system and that EAM searches are live reads.
    const tools = (await mcp.listTools()).tools;
    const search = tools.find((candidate) => candidate.name === 'eam_asset_search');
    expect(search?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    const file = tools.find((candidate) => candidate.name === 'filing_file');
    expect(file?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  } finally {
    await mcp.close();
    await server.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
