/**
 * The screenshots of `docs/getting-started.md`: a fresh `scaffold new` export, installed, built
 * and started, as the page's steps 2 to 5 leave it. The export takes minutes to install, so this
 * spec runs last in `bun run docs:screenshots`.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startService } from '../e2e/service';
import { shot } from './shots';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(command: string[], cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `${command.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
}

test('getting started: the exported inspection desk', async ({ page }) => {
  test.setTimeout(600_000);
  const directory = await mkdtemp(join(tmpdir(), 'getting-started-shots-'));
  const target = join(directory, 'inspection-desk');
  const app = join(target, 'showcase/examples/inspection-desk');
  try {
    run(
      [
        'bun',
        'packages/scaffold/src/cli.ts',
        'new',
        target,
        '--name',
        'inspection-desk',
        '--display-name',
        'Inspection Desk',
        '--collection',
        'inspection',
      ],
      root,
    );
    run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts'], target);
    run(['bun', 'run', 'build:web'], target, { AGENT_NATIVE_APPLICATION: app });
    const host = await startService(
      '@inspection-desk/application',
      join(directory, 'workspace'),
      {},
      target,
    );
    try {
      await page.goto(host.launchUrl);
      await expect(page.getByRole('heading', { name: 'Inspections', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
      await shot(page.locator('main'), 'getting-started', '05-inspections');

      await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Pump 4 quarterly');
      await page.getByRole('button', { name: 'Create' }).click();
      const row = page.getByRole('row', { name: 'Pump 4 quarterly' });
      await expect(row).toBeVisible();

      await row.click();
      await expect(page.getByRole('heading', { name: /^Inspection / })).toBeVisible();
      await shot(page.locator('main'), 'getting-started', '05-inspection');
    } finally {
      await host.stop();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
