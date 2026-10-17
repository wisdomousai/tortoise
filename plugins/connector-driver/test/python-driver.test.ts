import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceEffect, connectorConformance } from '@agent-native/testing/connectors';
import { driverContractFile } from '../src/cli';
import { createDriverConnector } from '../src/connect';
import { createDriverSupervisor, type DriverProcess } from '../src/supervisor';
import { checkDriver } from '../src/testing';
import { chamber } from './fixture';

/**
 * The Python SDK against the host: the stub generator, the protocol over a real child process,
 * and the shared connector conformance suite with the SDK's journal across restarts. Skipped
 * when no python3 is on PATH.
 */
const python = Bun.which('python3');
const sdk = join(import.meta.dir, '..', 'sdk', 'python');
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
    { env: { PYTHONPATH: join(sdk, 'src'), PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' },
  );
  if (generated.status !== 0) throw new Error(generated.stderr);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** A fresh simulated chamber; `start` launches its driver like the process port would. */
function simulation() {
  const home = join(root, `sim-${++simulations}`);
  mkdirSync(home, { recursive: true });
  const start = async (): Promise<DriverProcess> => {
    const child = spawn(python!, [join(sdk, 'examples', 'chamber_sim.py')], {
      env: {
        PYTHONPATH: [join(sdk, 'src'), root].join(':'),
        PYTHONDONTWRITEBYTECODE: '1',
        CHAMBER_SIM_DIR: home,
      },
      stdio: 'pipe',
    });
    await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
    return { child, terminate: () => void child.kill() };
  };
  const applied = async (id: string) => {
    const file = join(home, 'applied.json');
    return existsSync(file)
      ? ((JSON.parse(await readFile(file, 'utf8')) as Record<string, number>)[id] ?? 0)
      : 0;
  };
  const control = (name: string) => writeFileSync(join(home, name), '');
  return { home, start, applied, control };
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
      {
        env: { PYTHONPATH: join(sdk, 'src'), PYTHONDONTWRITEBYTECODE: '1' },
        encoding: 'utf8',
      },
    );
    expect(generated.status).toBe(1);
    expect(generated.stderr).toContain('does not match');
  });

  test('the SDK unit tests pass', () => {
    const run = spawnSync(python!, ['-m', 'unittest', 'discover', '-s', join(sdk, 'tests')], {
      env: { PYTHONPATH: join(sdk, 'src'), PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
    });
    expect(run.stderr).toContain('OK');
    expect(run.status).toBe(0);
  });
});

const inputs = {
  'setpoint.set': { accepted: (n: number) => ({ setpoint: 40 + n }), rejected: { setpoint: 999 } },
  'cycle.start': {
    accepted: (n: number) => ({ program: `p${n}`, presence: { confirmedBy: 'ina' } }),
    rejected: { program: 'refuse', presence: { confirmedBy: 'ina' } },
  },
  'label.print': { accepted: (n: number) => ({ text: `lot ${n}` }), rejected: { text: 'refuse' } },
} as const;

for (const [type, input] of Object.entries(inputs))
  describe.skipIf(!python)(`a Python driver conforms for ${type}`, () => {
    for (const check of connectorConformance(async () => {
      const sim = simulation();
      const supervisor = createDriverSupervisor({
        contract: chamber,
        start: sim.start,
        backoff: { minMs: 0, maxMs: 0 },
        healthMs: 0,
      });
      const port = createDriverConnector({
        target: 'chamber',
        contract: chamber,
        supervisor,
        control: async () => ({ mode: 'actuate' }),
        pollMs: 5,
      });
      let next = 0;
      const effect = (payload: object) =>
        conformanceEffect({
          id: `${type}-${++next}`,
          target: 'chamber',
          type,
          payload: payload as never,
        });
      return {
        port,
        accepted: () => effect(input.accepted(next)),
        rejected: () => effect(input.rejected),
        applied: (target) => sim.applied(target.id),
        failNext: () => sim.control('fail-next'),
        interruptNext: () => sim.control('crash-next'),
        close: () => supervisor.close(),
      };
    }))
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
