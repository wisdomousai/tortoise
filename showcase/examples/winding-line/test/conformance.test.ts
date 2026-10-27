import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { createAccessibilityExtractor } from '@agent-native/screen-bridge';
import { startHost } from '@agent-native/host/host';
import { createWindingLineApplication } from '../application';
import { createWindingLineBridge } from '../bridge';
import { FakeMes } from '../fake-mes';
import { createSimulatorOcr, createSimulatorTransport } from '../fake-hmi/memory';
import { HmiSimulator } from '../fake-hmi/simulator';

test('a station observed through its screen reads the same on every transport; each principal calls only its own operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-station-'));
  const mes = new FakeMes();
  // Loops disabled and no browser: the test drives the bridge over the in-memory simulator.
  const host = await startHost(createWindingLineApplication({ mes, stations: [] }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
  });
  const sim = new HmiSimulator();
  const bridge = createWindingLineBridge({
    application: host.application,
    workspaceId: 'local',
    station: 'winder-1',
    transport: createSimulatorTransport(sim),
    extractors: [createAccessibilityExtractor(), createSimulatorOcr(() => sim.state)],
    sleep: async () => undefined,
  });
  const ownerConnection = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token: ownerConnection.token });
  const operatorSession = host.sessions.create({ workspaceId: 'local', principalId: 'olga' });
  const operator = createHttpTransport({ baseUrl: host.url, token: operatorSession.token });
  const operatorServer = createMcpServer(operator);
  const operatorMcp = new Client({ name: 'station-conformance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  const file = join(directory, 'operator-connection.json');
  await writeFile(file, JSON.stringify({ endpoint: host.url, token: operatorSession.token }), {
    mode: 0o600,
  });
  const cli = async (args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@agent-native/adapters/cli', import.meta.dir), ...args],
      {
        env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: file },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { exitCode, value: JSON.parse(stdout) };
  };
  try {
    await operatorServer.connect(serverTransport);
    await operatorMcp.connect(clientTransport);
    expect((await host.integrations.target('mes').inbound.runOnce()).items).toBeGreaterThan(0);
    await owner.command(
      'line.station.set-member',
      { station: 'winder-1', principalId: 'olga', role: 'operator' },
      { idempotencyKey: 'member-olga' },
    );
    sim.stopMachine();
    await bridge.observer.runOnce();
    await bridge.observer.runOnce();

    // Observed state, with provenance, is identical over direct, HTTP, CLI and MCP.
    const input = { station: 'winder-1' };
    const direct = await host.application.queryRaw(
      { operation: 'line.station.get', input },
      operatorSession.context,
    );
    const http = await operator.query('line.station.get', input);
    const commandLine = await cli(['line.station.get', '--json', JSON.stringify(input)]);
    const mcp = decode(
      await operatorMcp.callTool({ name: 'line_station_get', arguments: { input } }),
    );
    expect((direct.data as any).readings.machine).toMatchObject({
      value: 'STOPPED',
      source: 'accessibility',
    });
    expect(http.data).toEqual(direct.data);
    expect(commandLine.exitCode).toBe(0);
    expect(commandLine.value.data).toEqual(direct.data);
    expect(mcp.data).toEqual(direct.data);

    // Agents see that starting an order reaches an external system, and cannot do it themselves.
    const tools = await operatorMcp.listTools();
    expect(
      tools.tools.find((tool) => tool.name === 'line_order_start')?.annotations?.openWorldHint,
    ).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'line_observation_ingest')).toBe(true);

    // The owner (supervisor, a person) enables actuation; the bridge loads the recipe on screen.
    await owner.command(
      'line.bridge.set-mode',
      { station: 'winder-1', mode: 'actuate' },
      { idempotencyKey: 'mode' },
    );
    await operator.command(
      'line.control.request',
      { station: 'winder-1', holder: 'agent' },
      { idempotencyKey: 'control' },
    );
    const started = await operator.command<{ desired: { sync: string; effectId: string } }>(
      'line.order.start',
      { station: 'winder-1', orderId: 'ORD-7002' },
      { idempotencyKey: 'start-7002' },
    );
    expect(started.result.desired.sync).toBe('pending');
    expect(await bridge.dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    expect(sim.state.recipe).toBe('R-100');
    const after = await operator.query<{ desired: { sync: string } }>('line.station.get', input);
    expect(after.data.desired.sync).toBe('accepted');

    // Separation: people cannot report observations; the bridge cannot read people's queries or touch
    // device configuration; operators read but cannot administer scanners.
    await expect(
      operator.command(
        'line.observation.ingest',
        {
          station: 'winder-1',
          profile: { id: 'x', version: '1' },
          screen: null,
          observedAt: Date.now(),
          frameDigest: 'd',
          localInput: false,
          readings: [],
        },
        { idempotencyKey: 'forged' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      host.application.queryRaw({ operation: 'device.config.get', input: input }, bridge.context),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await operator.query('device.config.get', input)).data).toMatchObject({
      station: 'winder-1',
      scanners: [],
    });
    await expect(
      operator.command(
        'device.routes.save',
        { station: 'winder-1', routes: [] },
        { idempotencyKey: 'routes' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await owner.command(
      'device.routes.save',
      { station: 'winder-1', routes: [] },
      { idempotencyKey: 'routes-owner' },
    );
  } finally {
    await operatorMcp.close();
    await operatorServer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
