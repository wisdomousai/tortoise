import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { driverContractFile } from '@tortoise/connector-driver/cli';
import type { DriverProcess } from '@tortoise/connector-driver/supervisor';
import { checkDriver } from '@tortoise/connector-driver/testing';
import { instrumentContract } from '../contracts/instrument';
import { connectInstrument, setup, T0, until } from './instrument-fixture';

/**
 * The Python instrument driver with its real serial code, against a simulated instrument on a
 * pseudo-terminal pair: no hardware, but pyserial opens, configures and reads a real tty. Runs
 * where python3 and pyserial are available, either installed or in uv's cache (it never
 * downloads); POSIX only, because the simulator needs a pty.
 */
const drivers = resolve(import.meta.dir, '..', 'drivers', 'instrument');
const sdk = resolve(import.meta.dir, '../../../../sdks/driver-python/src');
const python3 = Bun.which('python3');

/** A Python that can import pyserial, as a command prefix. */
function serialPython(): string[] | undefined {
  if (!python3 || process.platform === 'win32') return undefined;
  if (spawnSync(python3, ['-c', 'import serial']).status === 0) return [python3];
  const uv = Bun.which('uv');
  const prefix = uv && [uv, 'run', '--offline', '--no-project', '--with', 'pyserial', 'python'];
  return prefix && spawnSync(prefix[0]!, [...prefix.slice(1), '-c', 'import serial']).status === 0
    ? prefix
    : undefined;
}
const python = serialPython();

const environment = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  PYTHONPATH: [sdk, drivers].join(delimiter),
  PYTHONDONTWRITEBYTECODE: '1',
  ...extra,
});

/** The simulated instrument; `send` puts one line on the wire, as a key press would. */
async function simulator() {
  const child = spawn(python3!, [join(drivers, 'simulator.py')], { stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  const device = await new Promise<string>((done) => lines.once('line', done));
  return {
    device,
    send: (line: string) => void child.stdin.write(`${line}\n`),
    close: () => (child.stdin.end(), child.kill()),
  };
}

/** Launch the driver as the process port would, configured for `device`. */
const driverStart = (device: string) => async (): Promise<DriverProcess> => {
  const child = spawn(python![0]!, [...python!.slice(1), join(drivers, 'instrument_driver.py')], {
    env: environment({ INSTRUMENT_PORT: device, INSTRUMENT_ID: 'AD-4410' }),
    stdio: 'pipe',
  }) as ChildProcessWithoutNullStreams;
  // The supervisor drops driver stderr; the test shows it, where an unclassified failure says why.
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  await new Promise((done, fail) => child.once('spawn', done).once('error', fail));
  return { child, terminate: () => void child.kill() };
};

let root = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'instrument-driver-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!python3)('the instrument driver stub', () => {
  test('the committed stub is the one generated from the contract', async () => {
    await writeFile(
      join(root, 'contract.json'),
      JSON.stringify(driverContractFile(instrumentContract)),
    );
    const generated = spawnSync(
      python3!,
      ['-m', 'tortoise_driver.stubgen', join(root, 'contract.json'), '-o', join(root, 'stub.py')],
      { env: environment(), encoding: 'utf8' },
    );
    expect(generated.stderr).toBe('');
    expect(await readFile(join(root, 'stub.py'), 'utf8')).toBe(
      await readFile(join(drivers, 'instrument_contract.py'), 'utf8'),
    );
  });
});

describe.skipIf(!python)('the instrument driver on a pty pair', () => {
  // A fresh pty for each case, as a newly plugged-in instrument. Linux (seen on 6.17) refuses to
  // reconfigure a pty slave a second time: the next open fails in tcsetattr with EINVAL.
  let sim: Awaited<ReturnType<typeof simulator>> | undefined;
  beforeEach(async () => {
    sim = await simulator();
  });
  afterEach(() => sim?.close());

  test('its unit tests pass', () => {
    const run = spawnSync(
      python![0]!,
      [...python!.slice(1), '-m', 'unittest', 'test_instrument_driver'],
      {
        cwd: drivers,
        env: environment(),
        encoding: 'utf8',
      },
    );
    expect(run.stderr).toContain('OK');
    expect(run.status).toBe(0);
  });

  test('it passes every check without acting', async () => {
    const checks = await checkDriver({
      contract: instrumentContract,
      start: driverStart(sim!.device),
    });
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  }, 30_000);

  test('a stable line becomes a reading an inspector confirms; an unplugged port fails health', async () => {
    const { app, readings, record } = await setup();
    const instrument = connectInstrument(app, driverStart(sim!.device), {
      now: () => T0,
      healthMs: 200,
    });
    try {
      await instrument.supervisor.ready();
      sim!.send('US,+00220.010 mm');
      sim!.send('OL,+9999999E+19');
      sim!.send('ST,+00220.030 mm');
      await until(async () => (await readings()).length === 1);
      expect(await readings()).toEqual([
        expect.objectContaining({
          value: 220.03,
          unit: 'mm',
          device: { driver: 'ad-serial-instrument', driverVersion: '1.0.0', serial: 'AD-4410' },
        }),
      ]);
      const reading = (await readings())[0];
      expect((await record(reading)).result).toMatchObject({
        value: 220.03,
        instrument: { readingId: reading.id, serial: 'AD-4410' },
      });
      expect(await instrument.supervisor.read(['stable', 'unit', 'value'])).toMatchObject({
        values: { stable: true, unit: 'mm', value: 220.03 },
      });

      sim!.send('unplug');
      await until(async () =>
        instrument.problems.some((problem) => problem.includes('failed its health check')),
      );
      expect(instrument.errors).toEqual([]);
    } finally {
      await instrument.close();
    }
  }, 30_000);
});
