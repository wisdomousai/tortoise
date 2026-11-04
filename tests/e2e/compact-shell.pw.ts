import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './service';

// A tablet in portrait, as a hub's screens appear in an attached tablet's web view.
test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true });

test('on a tablet the sidebar becomes a bar and a menu sheet that closes on navigation', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-compact-'));
  const host = await startService('@tortoise/quality-inspection', workspace);
  try {
    await page.goto(host.launchUrl);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await expect(sections).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Navigation' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: 'Compliance', exact: true }).tap();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Compliance status' })).toBeVisible();

    await page.getByRole('button', { name: 'Find an action' }).tap();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();

    // Back to a wide window: the sidebar returns and the bar goes.
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(sections).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
