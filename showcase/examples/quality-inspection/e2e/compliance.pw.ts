import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

test('the compliance screen shows posture and a new denial without a reload', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-compliance-'));
  const host = await startService('@tortoise/quality-inspection', workspace);
  try {
    await page.goto(host.launchUrl);
    await page.getByRole('link', { name: 'Compliance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Security posture' })).toBeVisible();
    // No site policy: the service runs isolated, and says which destinations that closes.
    await expect(page.getByText('network isolated', { exact: false })).toBeVisible();
    await expect(page.getByRole('row', { name: /openai-api/ })).toContainText('isolated');
    await expect(page.getByText('chain verified', { exact: false })).toBeVisible();
    await expect(page.getByText('Nothing has been denied.')).toBeVisible();

    // Completing outbox effects belongs to the integration principal, so the local user is refused.
    const refused = await page.request.post(
      `${host.origin}/api/v1/commands/inspection.effect.complete`,
      {
        headers: { Origin: host.origin },
        data: {
          input: { effectId: 'effect-1', outcome: { status: 'accepted' } },
          idempotencyKey: 'compliance-e2e-1',
        },
      },
    );
    expect(refused.status()).toBe(403);
    // The screen polls the audit log; the denial appears on its own.
    const denial = page.getByRole('row', { name: /command\.denied/ });
    await expect(denial).toContainText('inspection.effect.complete', { timeout: 10_000 });
    await expect(page.getByText('Nothing has been denied.')).toHaveCount(0);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
