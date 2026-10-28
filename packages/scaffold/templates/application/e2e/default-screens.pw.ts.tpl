import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

test('the default {{many.words}} screens create, list, open and edit {{one.a}}', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), '{{app.kebab}}-screens-'));
  const host = await startService('{{packageName}}', workspace);
  try {
    await page.goto(host.launchUrl);
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: '{{many.title}}' })
      .click();
    await expect(page.getByRole('heading', { name: '{{many.title}}', level: 1 })).toBeVisible();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('First {{one.words}}');
    await page.getByRole('button', { name: 'Create' }).click();
    // The list is live: the new row appears without a reload.
    const row = page.getByRole('row', { name: 'First {{one.words}}' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: /^{{one.title}} / })).toBeVisible();
    // Every update field is optional, so the label says so.
    await page.getByRole('textbox', { name: /^Title/ }).fill('Renamed {{one.words}}');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'Renamed {{one.words}}' })).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
