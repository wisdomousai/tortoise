import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { startService } from '../../../../tests/e2e/service';

const drivers = resolve(import.meta.dirname, '..', 'drivers', 'instrument');
const sdk = resolve(import.meta.dirname, '../../../../sdks/driver-python/src');

/**
 * A Python environment for the driver, made the way an installer makes one: a venv with pyserial
 * (from uv's cache, never downloaded) and the SDK on its path. The deployment policy may not set
 * PYTHONPATH, so the environment itself has to provide both. Undefined where it cannot be made.
 */
function driverPython(directory: string): string | undefined {
  if (process.platform === 'win32' || spawnSync('uv', ['--version']).status !== 0) return undefined;
  const venv = join(directory, 'venv');
  const python = join(venv, 'bin', 'python');
  const run = (args: string[]) => spawnSync('uv', args, { encoding: 'utf8' }).status === 0;
  if (!run(['venv', '--offline', '--quiet', venv])) return undefined;
  if (!run(['pip', 'install', '--offline', '--quiet', '--python', python, 'pyserial']))
    return undefined;
  const site = spawnSync(python, ['-c', 'import site; print(site.getsitepackages()[0])'], {
    encoding: 'utf8',
  }).stdout.trim();
  spawnSync('sh', ['-c', `printf '%s\\n' "$1" > "$2"`, 'sh', sdk, join(site, 'tortoise.pth')]);
  return python;
}

test('an instrument reading is offered on the capture station and recorded with one action', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-instrument-'));
  const python = driverPython(workspace);
  test.skip(!python, 'needs uv with pyserial in its cache, on macOS or Linux');
  // The instrument: a pty pair whose device side the driver opens as its serial port.
  const simulator = spawn('python3', [join(drivers, 'simulator.py')], { stdio: 'pipe' });
  const device = await new Promise<string>((done) =>
    createInterface({ input: simulator.stdout }).once('line', done),
  );
  const policy = join(workspace, 'deployment-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      processes: {
        'instrument-driver': {
          executable: python,
          args: [join(drivers, 'instrument_driver.py')],
          cwd: drivers,
          env: { INSTRUMENT_PORT: device, INSTRUMENT_ID: 'AD-4410', PYTHONDONTWRITEBYTECODE: '1' },
        },
      },
    }),
  );
  const host = await startService('@tortoise/quality-inspection', join(workspace, 'data'), {
    TORTOISE_DEPLOYMENT_POLICY: policy,
  });
  try {
    await page.goto(host.launchUrl);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await sections.getByRole('link', { name: 'Lots' }).click();
    await page.getByRole('row', { name: 'Inspect lot 4000001' }).click();
    await expect(page.getByLabel('Measured Outer diameter')).toBeFocused();
    const offer = page.getByRole('region', { name: 'Instrument reading' });
    await expect(offer).toHaveCount(0);

    // The inspector presses the gauge's data button: the reading appears without a refresh.
    simulator.stdin.write('ST,+00220.030 mm\n');
    await expect(offer).toContainText('220.03 mm', { timeout: 10_000 });
    await expect(offer).toContainText('Instrument AD-4410');
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/instrument-reading.png', fullPage: true });

    await offer.getByRole('button', { name: 'Use reading' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recorded 220.03' })).toContainText(
      'DIAM sample 1: in tolerance',
    );
    await expect(offer).toHaveCount(0);
    await expect(page.getByText('NOW MEASURING · SAMPLE 2 OF 3')).toBeVisible();

    const response = await page.request.post(`${host.origin}/api/v1/queries/inspection.lot.get`, {
      headers: { Origin: host.origin },
      data: { input: { id: '4000001' } },
    });
    const lot = (await response.json()).data as {
      characteristics: { id: string; results: { value?: number; instrument?: object }[] }[];
    };
    expect(lot.characteristics.find((item) => item.id === 'C10')!.results).toEqual([
      expect.objectContaining({
        value: 220.03,
        instrument: expect.objectContaining({ driver: 'ad-serial-instrument', serial: 'AD-4410' }),
      }),
    ]);
  } finally {
    await host.stop();
    simulator.stdin.end();
    simulator.kill();
    await rm(workspace, { recursive: true, force: true });
  }
});
