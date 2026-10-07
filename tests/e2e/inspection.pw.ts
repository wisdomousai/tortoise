import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './service';

/** Read committed lot state through the same authority API the screen uses. */
async function lot(page: Page, origin: string, id: string) {
  const response = await page.request.post(`${origin}/api/v1/queries/inspection.lot.get`, {
    headers: { Origin: origin },
    data: { input: { id } },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as {
    characteristics: { id: string; results: { sample: number; value?: number }[] }[];
  };
}

test('keyboard-only capture records, advances, deduplicates and shows SoR outcomes live', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-inspection-'));
  // Another quality-system user holds lot 4000002, so its forwarded results are rejected.
  const host = await startService(workspace, { DEMO_QUALITY_LOCKED_LOTS: '4000002' });
  try {
    await page.goto(host.launchUrl);
    await page.getByRole('link', { name: 'Inspection', exact: true }).click();
    // Lots arrive from the quality system through inbound sync, not from a user.
    const row = page.getByRole('row', { name: 'Inspect lot 4000001' });
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Enter');

    // The worklist puts focus on the first open sample; no mouse from here on.
    const diameter = page.getByLabel('Measured Outer diameter');
    await expect(diameter).toBeFocused();
    await expect(page.getByText('NOW MEASURING · SAMPLE 1 OF 3')).toBeVisible();
    await page.keyboard.type('220.02');
    await expect(page.getByText('In tolerance', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Recorded 220.02' })).toContainText(
      'DIAM sample 1: in tolerance',
    );
    await expect(page.getByText('NOW MEASURING · SAMPLE 2 OF 3')).toBeVisible();
    await expect(diameter).toBeFocused();
    await expect(diameter).toHaveValue('');

    // A keyboard-wedge gauge types the whole value in a burst and terminates with Enter.
    await page.keyboard.type('220.04', { delay: 4 });
    await page.keyboard.press('Enter');
    await expect(page.getByText('NOW MEASURING · SAMPLE 3 OF 3')).toBeVisible();

    // A double Enter (double tap or a gauge sending twice) still records one datapoint.
    await page.keyboard.type('220.01');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByText('NOW MEASURING · SAMPLE 1 OF 3')).toBeVisible();
    await expect(page.getByLabel('Measured Disc thickness')).toBeFocused();
    const recorded = await lot(page, host.origin, '4000001');
    expect(recorded.characteristics.find((item) => item.id === 'C10')!.results).toHaveLength(3);
    expect(recorded.characteristics.find((item) => item.id === 'C20')!.results).toHaveLength(0);

    // Accepted results show the quality system's reference once the outbox delivers them.
    await expect(page.getByText(/^QM-\d{6}$/).first()).toBeVisible({ timeout: 10_000 });
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/capture-station.png', fullPage: true });

    // A rejection by the quality system appears on screen without a refresh.
    await page.getByRole('link', { name: 'Lots' }).click();
    await page.getByRole('row', { name: 'Inspect lot 4000002' }).click();
    await expect(page.getByLabel('Measured Bore diameter')).toBeFocused();
    await page.keyboard.type('88.001');
    await page.keyboard.press('Enter');
    await expect(page.getByText('LOT_LOCKED').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /1 rejected/ })).toBeVisible();

    // The economics are measured, not asserted: median seconds per human datapoint.
    await page.getByRole('link', { name: 'Inspection', exact: true }).click();
    const metrics = page.getByRole('region', { name: 'Capture metrics' });
    await expect(metrics).toContainText('4 captured');
    await expect(metrics.getByText(/^\d+\.\d s$/).first()).toBeVisible();

    // A form generated from the plant.set-member contract grants a role in one line of UI code.
    await page.getByLabel('Plant', { exact: true }).fill('P100');
    await page.getByLabel('Principal Id').fill('ina');
    await page.getByLabel('Role').selectOption('inspector');
    await page.getByRole('button', { name: 'Update plant role' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

    // Triage: correct the rejected result. The correction supersedes it (the original leaves the
    // open rejections) and is forwarded again; the lot is still locked, so it is rejected too.
    await page.getByRole('link', { name: 'Synchronization' }).click();
    const original = (await page
      .getByText(/^result:/)
      .first()
      .textContent())!;
    await page.getByRole('button', { name: 'Correct result' }).click();
    await page.getByLabel('Corrected value').fill('88.002');
    await page.getByLabel('Reason').fill('Re-measured after the lock was released');
    await page.getByRole('button', { name: 'Submit correction' }).click();
    await expect(page.getByText(original, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^result:/)).toHaveCount(1, { timeout: 10_000 });
    expect(
      await page
        .getByText(/^result:/)
        .first()
        .textContent(),
    ).not.toBe(original);
    await page.screenshot({ path: 'artifacts/inspection-sync.png', fullPage: true });
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
