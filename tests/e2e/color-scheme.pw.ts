import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './service';

test('the frame follows the OS color scheme with the dark tokens', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-color-scheme-'));
  const host = await startService('@tortoise/quality-inspection', workspace);
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(host.launchUrl);
    const root = page.locator('html');
    await expect(root).toHaveClass(/\bdark\b/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(root).not.toHaveClass(/\bdark\b/);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
