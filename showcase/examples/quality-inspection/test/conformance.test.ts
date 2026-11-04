import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import { targetContext } from '@tortoise/integration';
import { createQualityInspectionApplication, INTEGRATION_PRINCIPAL } from '../application';
import { qualityTarget } from '../contracts';
import { FakeQualitySystem } from '../fake-sor';

test('a datapoint captured over any transport commits once, is forwarded once and completes live', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-inspection-'));
  const systemOfRecord = new FakeQualitySystem();
  // Loops disabled: the test drives sync and delivery passes so ordering is deterministic.
  const host = await startHost(createQualityInspectionApplication({ systemOfRecord }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const localUserConnection = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const localUser = createHttpTransport({ baseUrl: host.url, token: localUserConnection.token });
  const inspectorSession = host.sessions.create({ workspaceId: 'local', principalId: 'ina' });
  const viewerSession = host.sessions.create({ workspaceId: 'local', principalId: 'vic' });
  const inspector = createHttpTransport({ baseUrl: host.url, token: inspectorSession.token });
  const viewer = createHttpTransport({ baseUrl: host.url, token: viewerSession.token });
  const connectionFile = async (name: string, token: string) => {
    const file = join(directory, `${name}-connection.json`);
    await writeFile(file, JSON.stringify({ endpoint: host.url, token }), { mode: 0o600 });
    return file;
  };
  const inspectorFile = await connectionFile('inspector', inspectorSession.token);
  const viewerFile = await connectionFile('viewer', viewerSession.token);
  const cli = async (file: string, args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir), ...args],
      {
        env: { PATH: process.env.PATH, TORTOISE_CONNECTION: file },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (!stdout.trim()) throw new Error(`CLI produced no JSON: ${stderr}`);
    return { exitCode, value: JSON.parse(stdout) };
  };
  const inspectorServer = createMcpServer(inspector);
  const viewerServer = createMcpServer(viewer);
  const inspectorMcp = new Client({ name: 'inspector-conformance', version: '1.0.0' });
  const viewerMcp = new Client({ name: 'viewer-conformance', version: '1.0.0' });
  const [inspectorClientTransport, inspectorServerTransport] = InMemoryTransport.createLinkedPair();
  const [viewerClientTransport, viewerServerTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  try {
    await inspectorServer.connect(inspectorServerTransport);
    await inspectorMcp.connect(inspectorClientTransport);
    await viewerServer.connect(viewerServerTransport);
    await viewerMcp.connect(viewerClientTransport);

    // Master data is imported from the SoR through the integration principal, never entered by a person.
    expect(
      (await host.integrations.target('quality-system').inbound.runOnce()).items,
    ).toBeGreaterThan(0);
    await localUser.command(
      'inspection.plant.set-member',
      { plant: 'P100', principalId: 'ina', role: 'inspector' },
      { idempotencyKey: 'member-ina' },
    );
    await localUser.command(
      'inspection.plant.set-member',
      { plant: 'P100', principalId: 'vic', role: 'viewer' },
      { idempotencyKey: 'member-vic' },
    );

    // The capture loop's worklist is identical across every transport.
    const worklistInput = { lotId: '4000001' };
    const direct = await host.application.queryRaw(
      { operation: 'inspection.worklist', input: worklistInput },
      inspectorSession.context,
    );
    const http = await inspector.query('inspection.worklist', worklistInput);
    const commandLine = await cli(inspectorFile, [
      'inspection.worklist',
      '--json',
      JSON.stringify(worklistInput),
    ]);
    const mcp = decode(
      await inspectorMcp.callTool({
        name: 'inspection_worklist',
        arguments: { input: worklistInput },
      }),
    );
    expect(http.data).toEqual(direct.data);
    expect(commandLine.exitCode).toBe(0);
    expect(commandLine.value.data).toEqual(direct.data);
    expect(mcp.data).toEqual(direct.data);

    // Agents learn from tool metadata that this write reaches an external system.
    const tools = await inspectorMcp.listTools();
    const recordTool = tools.tools.find((tool) => tool.name === 'inspection_result_record');
    expect(recordTool?.annotations?.openWorldHint).toBe(true);
    expect(
      tools.tools.find((tool) => tool.name === 'inspection_worklist')?.annotations?.openWorldHint,
    ).toBe(false);

    const input = {
      lotId: '4000001',
      characteristicId: 'C10',
      value: 220.02,
      occurredAt: Date.now() - 1_000,
      station: 'CMM-2',
    };
    // A viewer is denied with the same code on every transport.
    await expect(
      viewer.command('inspection.result.record', input, { idempotencyKey: 'viewer-http' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const deniedCli = await cli(viewerFile, [
      'inspection.result.record',
      '--json',
      JSON.stringify(input),
      '--key',
      'viewer-cli',
    ]);
    expect(deniedCli.exitCode).toBe(4);
    expect(deniedCli.value.error.code).toBe('FORBIDDEN');
    const deniedMcp = await viewerMcp.callTool({
      name: 'inspection_result_record',
      arguments: { input, idempotencyKey: 'viewer-mcp' },
    });
    expect(deniedMcp.isError).toBe(true);
    expect(decode(deniedMcp).error.code).toBe('FORBIDDEN');

    // An agent records over MCP; a retry over HTTP or CLI with the same key replays the receipt.
    const recorded = decode(
      await inspectorMcp.callTool({
        name: 'inspection_result_record',
        arguments: { input, idempotencyKey: 'capture-1' },
      }),
    );
    expect(recorded.result).toMatchObject({ sample: 1, evaluation: 'accepted', sync: 'pending' });
    expect(recorded.effects).toHaveLength(1);
    const retryHttp = await inspector.command('inspection.result.record', input, {
      idempotencyKey: 'capture-1',
    });
    const retryCli = await cli(inspectorFile, [
      'inspection.result.record',
      '--json',
      JSON.stringify(input),
      '--key',
      'capture-1',
    ]);
    expect(retryHttp.result).toEqual(recorded.result);
    expect(retryCli.exitCode).toBe(0);
    expect(retryCli.value.result).toEqual(recorded.result);
    expect(
      await host.application.pendingEffects(
        targetContext(qualityTarget, 'local', INTEGRATION_PRINCIPAL),
      ),
    ).toHaveLength(1);

    // Delivery happens after commit; the outcome is written back through a domain command.
    const report = await host.integrations.target('quality-system').dispatcher.runOnce();
    expect(report).toMatchObject({ accepted: 1, rejected: 0 });
    expect(systemOfRecord.documents.size).toBe(1);
    const lot = await inspector.query<{
      characteristics: { id: string; results: { sync: string; sorRef?: string }[] }[];
    }>('inspection.lot.get', { id: '4000001' });
    const result = lot.data.characteristics.find((c) => c.id === 'C10')!.results[0]!;
    expect(result.sync).toBe('accepted');
    expect(result.sorRef).toMatch(/^QM-/);
  } finally {
    await inspectorMcp.close();
    await viewerMcp.close();
    await inspectorServer.close();
    await viewerServer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
