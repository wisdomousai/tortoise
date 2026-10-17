import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driverContractFile } from '@agent-native/connector-driver/cli';
import type { DriverProcess } from '@agent-native/connector-driver/supervisor';
import { checkDriver } from '@agent-native/connector-driver/testing';
import { stationAutomationContract } from '../contracts/automation';
import { automationRoute } from './automation-route';

/**
 * The .NET station automation driver in `drivers/automation`, against a simulated station: the
 * committed stub matches the contract, the driver passes `checkDriver`, and the line station runs
 * on it as a real child process, including a crash after the station took a load. It builds into
 * a temporary artifacts directory, so no `bin` or `obj` lands in the tree. Skipped when `dotnet`
 * is not on PATH.
 */
const dotnet = Bun.which('dotnet');
const project = join(import.meta.dir, '..', 'drivers', 'automation');
const stubgen = join(
  import.meta.dir,
  '../../../sdks/driver-dotnet/src/AgentNative.Driver.Stubgen/AgentNative.Driver.Stubgen.csproj',
);
const env = {
  ...process.env,
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
};
let root = '';
let stations = 0;
const dll = (name: string) => join(root, 'artifacts', 'bin', name, 'debug', `${name}.dll`);

beforeAll(async () => {
  if (!dotnet) return;
  root = await mkdtemp(join(tmpdir(), 'station-automation-'));
  for (const build of [join(project, 'StationAutomation.csproj'), stubgen]) {
    const built = spawnSync(
      dotnet,
      ['build', build, '--artifacts-path', join(root, 'artifacts'), '-v', 'q'],
      { env, encoding: 'utf8' },
    );
    if (built.status !== 0) throw new Error(built.stdout + built.stderr);
  }
}, 300_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** A fresh simulated station; `start` launches the driver the way the process port would. */
function simulatedStation() {
  const home = join(root, `station-${++stations}`);
  mkdirSync(home, { recursive: true });
  const file = join(home, 'station.json');
  // The driver writes the file when it starts; missing fields take the simulator's defaults.
  const read = async () =>
    JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Record<string, unknown>;
  return {
    home,
    read,
    async write(change: Record<string, unknown>) {
      await writeFile(file, JSON.stringify({ ...(await read()), ...change }));
    },
    control: (name: 'crash-next' | 'fail-next' | 'jam') => writeFile(join(home, name), ''),
    clear: (name: 'jam') => rm(join(home, name), { force: true }),
    async start(): Promise<DriverProcess> {
      const child = spawn(dotnet!, [dll('StationAutomation')], {
        env: { ...env, STATION_AUTOMATION_SIM_DIR: home },
        stdio: 'pipe',
      });
      await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
      return { child, terminate: () => void child.kill() };
    },
  };
}

describe.skipIf(!dotnet)('the .NET station automation driver', () => {
  test('the committed stub is what the generator writes from the contract', async () => {
    const file = driverContractFile(stationAutomationContract);
    await writeFile(join(root, 'station-automation.json'), JSON.stringify(file));
    const generated = spawnSync(
      dotnet!,
      [
        dll('AgentNative.Driver.Stubgen'),
        join(root, 'station-automation.json'),
        '--namespace',
        'StationAutomation',
      ],
      { env, encoding: 'utf8' },
    );
    expect(generated.stderr).toBe('');
    expect(generated.stdout).toContain(`public const string Digest = "${file.digest}";`);
    expect(generated.stdout).toBe(
      await readFile(join(project, 'StationAutomationContract.cs'), 'utf8'),
    );
  });

  test('it passes every check against a simulated station', async () => {
    const checks = await checkDriver({
      contract: stationAutomationContract,
      start: simulatedStation().start,
    });
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  test('it refuses to start without a configured station', () => {
    const started = spawnSync(dotnet!, [dll('StationAutomation')], {
      env: { ...env, STATION_AUTOMATION_SIM_DIR: '', STATION_AUTOMATION_PROGID: '' },
      encoding: 'utf8',
      input: '',
    });
    expect(started.status).toBe(2);
    expect(started.stderr).toContain('STATION_AUTOMATION_PROGID');
  });

  test('an order loads its recipe through the driver, accepted by readback', async () => {
    const station = simulatedStation();
    const route = await automationRoute({
      start: station.start,
      stopMachine: () => station.write({ machine: 'STOPPED' }),
    });
    await route.ready();
    expect(
      (await route.query('line.station.get', { station: 'line-1' })).readings.machine,
    ).toMatchObject({ value: 'STOPPED', source: 'driver.station-automation' });
    await route.command('line.order.start', { station: 'line-1', orderId: 'ORD-7002' });
    expect(await route.deliver()).toMatchObject({ accepted: 1 });
    expect(await station.read()).toMatchObject({ recipe: 'R-330', loads: 1 });
    await route.close();
  }, 30_000);

  test('a crash after a load the station does not show is held, then reconciled', async () => {
    const station = simulatedStation();
    const route = await automationRoute({
      start: station.start,
      stopMachine: () => station.write({ machine: 'STOPPED' }),
    });
    await route.ready();
    await route.command('line.order.start', { station: 'line-1', orderId: 'ORD-7002' });
    await station.control('jam');
    await station.control('crash-next');
    expect(await route.deliver()).toMatchObject({ retried: 1 });
    expect(await route.deliver()).toMatchObject({ held: 1 });
    expect(await station.read()).toMatchObject({ recipe: 'R-500', loads: 1 });
    // Held: never sent again on its own.
    expect(await route.deliver()).toMatchObject({ accepted: 0, held: 0 });
    const [item] = (await route.query('line.attention.list', { station: 'line-1' })).items;
    await station.clear('jam');
    await route.command('line.effect.reconcile', { effectId: item.effectId, applied: false });
    expect(await route.deliver()).toMatchObject({ accepted: 1 });
    expect(await station.read()).toMatchObject({ recipe: 'R-330', loads: 2 });
    await route.close();
  }, 30_000);
});
