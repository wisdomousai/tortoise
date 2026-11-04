import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import type { ExecutionContext } from '@tortoise/runtime';
import { createAssetSurveyApplication } from '../application';
import { nameplatePhoto } from '../connectors/nameplate-photo';

const localUser: ExecutionContext = { workspaceId: 'local', principalId: 'local-user' };
const device: ExecutionContext = { workspaceId: 'local', principalId: 'device:d1' };
const composite = 'capture.link-and-extract';

test('linking and extracting in one command commits both or neither on every surface', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-survey-nested-'));
  const host = await startHost(createAssetSurveyApplication(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const http = createHttpTransport({ baseUrl: host.url, token });
  const connection = join(directory, 'local-user-connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
  const cli = async (args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir), ...args],
      { env: { PATH: process.env.PATH, TORTOISE_CONNECTION: connection }, stdout: 'pipe' },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { exitCode, value: JSON.parse(stdout) };
  };
  const server = createMcpServer(http);
  const mcp = new Client({ name: 'survey-nested', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  const { application } = host;
  const direct = (
    operation: string,
    input: unknown,
    context = localUser,
    idempotencyKey?: string,
  ) =>
    application.invokeRaw(
      { operation, input, ...(idempotencyKey ? { idempotencyKey } : {}) },
      context,
    );
  const created = async (operation: string, input: unknown, context = localUser) =>
    (await direct(operation, input, context)).result as { id: string };
  const unlinked = async () =>
    (
      (
        await application.queryRaw(
          { operation: 'capture.list', input: { unlinked: true } },
          localUser,
        )
      ).data as { items: { id: string }[] }
    ).items
      .map((item) => item.id)
      .sort();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const node = (designation: string, name: string, parentId?: string) =>
      created('structure.node.create', {
        ...(parentId ? { parentId } : {}),
        scheme: 'iec81346',
        designation,
        name,
      });
    const g1 = await node('=G1', 'Generator 1');
    const q1 = await node('=G1-Q1', 'Generator circuit breaker', g1.id);
    const g2 = await node('=G2', 'Generator 2');
    const assignment = await created('assignment.survey.create', {
      title: 'Nameplates of =G1',
      scope: { roots: [g1.id], kinds: ['nameplate'] },
      assignee: { type: 'device', id: 'd1' },
    });
    const photo = await application.putBlob(
      nameplatePhoto({ manufacturer: 'ABB' }),
      'image/png',
      device,
    );
    // Captures of a node outside the survey are recorded unlinked.
    const ids = ['cap-direct', 'cap-http', 'cap-cli', 'cap-mcp'];
    for (const [index, id] of ids.entries())
      await direct(
        'assignment.survey.report',
        {
          id,
          assignmentId: assignment.id,
          subject: g2.id,
          body: { kind: 'nameplate', photos: [photo], codes: [], note: '', takenAt: 1_000 + index },
        },
        device,
      );
    expect(await unlinked()).toEqual([...ids].sort());
    const input = (id: string) => ({ id, nodeId: q1.id });

    // A grant without the extraction: the placement already ran, and rolls back with it.
    const scoped = (operations: string[]) =>
      createHttpTransport({
        baseUrl: host.url,
        token: host.sessions.create({ ...localUser, grant: { operations } }).token,
      });
    for (const operations of [
      [composite, 'assignment.report.link'],
      [composite, 'assignment.extraction.create'],
      [composite],
    ])
      await expect(
        scoped(operations).command(composite, input('cap-http'), { idempotencyKey: 'scoped' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      direct(composite, input('cap-http'), { ...localUser, principalId: 'vic' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await unlinked()).toEqual([...ids].sort());

    // Each surface links one capture and sends it to the model in one commit.
    const viaDirect = await direct(composite, input('cap-direct'), localUser, 'k-direct');
    const viaHttp = await http.command(composite, input('cap-http'), { idempotencyKey: 'k-http' });
    const viaCli = await cli([
      composite,
      '--json',
      JSON.stringify(input('cap-cli')),
      '--key',
      'k-cli',
    ]);
    expect(viaCli.exitCode).toBe(0);
    const mcpName = application.catalog.operations.find(
      (operation) => operation.id === composite,
    )!.mcpName;
    const viaMcp = decode(
      await mcp.callTool({
        name: mcpName,
        arguments: { input: input('cap-mcp'), idempotencyKey: 'k-mcp' },
      }),
    );
    for (const [receipt, id] of [
      [viaDirect, 'cap-direct'],
      [viaHttp, 'cap-http'],
      [viaCli.value, 'cap-cli'],
      [viaMcp, 'cap-mcp'],
    ] as const) {
      expect(receipt.result).toMatchObject({ capture: { id, nodeId: q1.id, reading: 'reading' } });
      expect(receipt.effects).toHaveLength(1);
      expect(Object.keys(receipt.revisions).sort()).toEqual(
        [`assignment-report:${id}`, `assignment:${receipt.result.extraction.id}`].sort(),
      );
    }
    expect(await unlinked()).toEqual([]);

    // A retry on another surface returns the same receipt and sends nothing twice.
    const retried = await cli([
      composite,
      '--json',
      JSON.stringify(input('cap-http')),
      '--key',
      'k-http',
    ]);
    expect(retried.value.result).toEqual(viaHttp.result);
    expect(retried.value.revisions).toEqual(viaHttp.revisions);
    const status = await application.queryRaw(
      { operation: 'assignment.model.status', input: {} },
      localUser,
    );
    expect(status.data).toMatchObject({ waiting: 4 });
  } finally {
    await mcp.close();
    await server.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
