import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driverContractFile } from '@tortoise/connector-driver/cli';
import type { DriverProcess } from '@tortoise/connector-driver/supervisor';
import {
  chamber,
  chamberConformance,
  checkDriver,
  type ChamberSimulation,
} from '@tortoise/connector-driver/testing';

/**
 * The Python SDK against the host: the stub generator, the protocol over a real child process,
 * and the shared connector conformance suite with the SDK's journal across restarts. Skipped
 * when no python3 is on PATH.
 */
const python = Bun.which('python3');
const sdk = join(import.meta.dir, '..');
const env = (extra: Record<string, string> = {}) => ({
  PYTHONPATH: join(sdk, 'src'),
  PYTHONDONTWRITEBYTECODE: '1',
  ...extra,
});
let root = '';
let simulations = 0;

beforeAll(async () => {
  if (!python) return;
  root = await mkdtemp(join(tmpdir(), 'driver-python-'));
  await writeFile(join(root, 'chamber.json'), JSON.stringify(driverContractFile(chamber)));
  const generated = spawnSync(
    python,
    [
      '-m',
      'agent_native_driver.stubgen',
      join(root, 'chamber.json'),
      '-o',
      join(root, 'chamber_contract.py'),
    ],
    { env: env(), encoding: 'utf8' },
  );
  if (generated.status !== 0) throw new Error(generated.stderr);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** A fresh simulated chamber; `start` launches its driver like the process port would. */
function simulation(): ChamberSimulation {
  const home = join(root, `sim-${++simulations}`);
  mkdirSync(home, { recursive: true });
  const start = async (): Promise<DriverProcess> => {
    const child = spawn(python!, [join(sdk, 'examples', 'chamber_sim.py')], {
      env: env({ PYTHONPATH: [join(sdk, 'src'), root].join(':'), CHAMBER_SIM_DIR: home }),
      stdio: 'pipe',
    });
    await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
    return { child, terminate: () => void child.kill() };
  };
  return { home, start };
}

describe.skipIf(!python)('the Python SDK', () => {
  test('the generated stub carries the host digest, and the driver passes every check', async () => {
    const stub = await readFile(join(root, 'chamber_contract.py'), 'utf8');
    expect(stub).toContain(`DIGEST = '${driverContractFile(chamber).digest}'`);
    expect(stub).toContain('class SetpointSetInput(TypedDict):');
    const checks = await checkDriver({ contract: chamber, start: simulation().start });
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  test('a stub generated from an edited contract is refused', async () => {
    const file = driverContractFile(chamber);
    await writeFile(
      join(root, 'edited.json'),
      JSON.stringify({ ...file, document: { ...file.document, version: '9' } }),
    );
    const generated = spawnSync(
      python!,
      ['-m', 'agent_native_driver.stubgen', join(root, 'edited.json')],
      { env: env(), encoding: 'utf8' },
    );
    expect(generated.status).toBe(1);
    expect(generated.stderr).toContain('does not match');
  });

  test('the SDK unit tests pass', () => {
    const run = spawnSync(python!, ['-m', 'unittest', 'discover', '-s', join(sdk, 'tests')], {
      env: env(),
      encoding: 'utf8',
    });
    expect(run.stderr).toContain('OK');
    expect(run.status).toBe(0);
  });
});

for (const { action, cases } of chamberConformance(simulation))
  describe.skipIf(!python)(`a Python driver conforms for ${action}`, () => {
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
