import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driverContractFile } from '@agent-native/connector-driver/cli';
import type { DriverProcess } from '@agent-native/connector-driver/supervisor';
import {
  chamber,
  chamberConformance,
  checkDriver,
  type ChamberSimulation,
} from '@agent-native/connector-driver/testing';

/**
 * The .NET SDK against the host: the solution builds offline from the .NET SDK alone into a
 * temporary artifacts directory, the committed chamber stub matches the host's contract, the SDK's
 * own tests pass, and the simulated chamber passes `checkDriver` and the connector conformance
 * suite as a real child process. Skipped when `dotnet` is not on PATH.
 */
const dotnet = Bun.which('dotnet');
const sdk = join(import.meta.dir, '..');
const env = {
  ...process.env,
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
};
let root = '';
let simulations = 0;
const dll = (project: string) => join(root, 'artifacts', 'bin', project, 'debug', `${project}.dll`);
const run = (project: string, args: string[]) =>
  spawnSync(dotnet!, [dll(project), ...args], { env, encoding: 'utf8' });

beforeAll(async () => {
  if (!dotnet) return;
  root = await mkdtemp(join(tmpdir(), 'driver-dotnet-'));
  const built = spawnSync(
    dotnet,
    [
      'build',
      join(sdk, 'AgentNative.Driver.slnx'),
      '--artifacts-path',
      join(root, 'artifacts'),
      '-v',
      'q',
    ],
    { env, encoding: 'utf8' },
  );
  if (built.status !== 0) throw new Error(built.stdout + built.stderr);
  await writeFile(join(root, 'chamber.json'), JSON.stringify(driverContractFile(chamber)));
}, 300_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** A fresh simulated chamber; `start` launches its driver like the process port would. */
function simulation(): ChamberSimulation {
  const home = join(root, `sim-${++simulations}`);
  mkdirSync(home, { recursive: true });
  const start = async (): Promise<DriverProcess> => {
    const child = spawn(dotnet!, [dll('ChamberSim')], {
      env: { ...env, CHAMBER_SIM_DIR: home },
      stdio: 'pipe',
    });
    await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
    return { child, terminate: () => void child.kill() };
  };
  return { home, start };
}

describe.skipIf(!dotnet)('the .NET SDK', () => {
  test('the committed chamber stub is what the generator writes from the host contract', async () => {
    const generated = run('AgentNative.Driver.Stubgen', [
      join(root, 'chamber.json'),
      '--namespace',
      'ChamberSim',
    ]);
    expect(generated.stderr).toBe('');
    expect(generated.stdout).toContain(
      `public const string Digest = "${driverContractFile(chamber).digest}";`,
    );
    expect(generated.stdout).toBe(
      await readFile(join(sdk, 'examples', 'ChamberSim', 'ChamberContract.cs'), 'utf8'),
    );
  });

  test('a stub generated from an edited contract is refused', async () => {
    const file = driverContractFile(chamber);
    await writeFile(
      join(root, 'edited.json'),
      JSON.stringify({ ...file, document: { ...file.document, version: '9' } }),
    );
    const generated = run('AgentNative.Driver.Stubgen', [
      join(root, 'edited.json'),
      '--namespace',
      'Edited',
    ]);
    expect(generated.status).toBe(1);
    expect(generated.stderr).toContain('does not match');
  });

  test('the SDK unit tests pass', () => {
    const tests = run('AgentNative.Driver.Tests', []);
    expect(tests.stdout).toContain('0 failed');
    expect(tests.status).toBe(0);
  });

  test('the simulated chamber passes every check', async () => {
    const checks = await checkDriver({ contract: chamber, start: simulation().start });
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });
});

for (const { action, cases } of chamberConformance(simulation))
  describe.skipIf(!dotnet)(`a .NET driver conforms for ${action}`, () => {
    for (const check of cases)
      test(
        check.name,
        async () => {
          const result = await check.run();
          expect(result).toEqual(
            check.name.startsWith('pull')
              ? { skipped: 'the connector has no pull' }
              : { passed: true },
          );
        },
        20_000,
      );
  });
