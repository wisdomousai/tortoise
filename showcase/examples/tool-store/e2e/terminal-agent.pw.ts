import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { addTool, enroll, sections, signIn } from './counter';

test('an attendant ticks a tool, a demo run opens it at the counter with a review, and the attendant saves the bin', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-agent-'));
  const host = await startService('@agent-native/tool-store', workspace);
  try {
    await page.goto(host.launchUrl);
    await enroll(page, 'mia@plant', 'E100001', '2468');
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    for (const [assetTag, description] of [
      ['TC-00901', 'Torque wrench 20-100 Nm'],
      ['TC-00902', 'Crimper 0.5-6 mm2'],
    ]) {
      await addTool(page, assetTag!, description!, 'torque-tool', 'A-03');
      await expect(page.getByRole('row', { name: `${assetTag} ${description}` })).toBeVisible();
    }
    await sections(page).getByRole('link', { name: 'Terminal' }).click();
    await signIn(page, 'E100001', '2468');
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();

    // The Tools tab lists the tools; ticking one makes it the UI session context.
    await page.getByRole('tab', { name: 'Tools' }).click();
    await expect(page.getByRole('heading', { name: 'Tools', level: 2 })).toBeVisible();
    const pull = page.getByRole('button', { name: 'Pull for calibration' });
    await expect(pull).toBeDisabled();
    const shared = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/ui/sessions') &&
        response.request().method() === 'POST' &&
        (response.request().postData() ?? '').includes('"tool:'),
    );
    await page.getByRole('checkbox', { name: 'Select TC-00901' }).click();
    expect((await shared).ok()).toBe(true);
    await expect(page.getByRole('checkbox', { name: 'Select TC-00901' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Select TC-00902' })).not.toBeChecked();

    // The demo harness is the default account. Pull for calibration starts its run.
    const agent = page.getByRole('region', { name: 'Agent', exact: true });
    await expect(agent).toContainText('Agent account Demo');
    const started = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/runs') && response.request().method() === 'POST',
    );
    await pull.click();
    const run = (await (await started).json()) as { id: string };

    // The run's open shows the tool on the Counter tab, and its review stands above the edit
    // form with the bin field focused and a line that names the run.
    await expect(page.getByRole('tab', { name: 'Counter' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Tool TC-00901' })).toBeVisible();
    const review = page.getByRole('region', { name: 'Agent review' });
    await expect(review).toContainText('Pull TC-00901 for calibration');
    await expect(review).toContainText(`Agent run ${run.id.slice(0, 8)} asks for this review.`);
    const bin = page.getByRole('textbox', { name: /^Bin/ });
    await expect(bin).toBeFocused();

    // The attendant enters the bin and saves; the run never wrote it.
    await expect(page.getByRole('definition').filter({ hasText: 'A-03' })).toBeVisible();
    await bin.fill('CAL-01');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'CAL-01' })).toBeVisible();
    await review.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(review).toHaveCount(0);

    // Back on the Tools tab: the row shows the new bin, the tool is still ticked, and the panel
    // shows the tools the latest run captured and the run's outcome.
    await page.getByRole('tab', { name: 'Tools' }).click();
    await expect(page.getByRole('row', { name: 'TC-00901 Torque wrench 20-100 Nm' })).toContainText(
      'CAL-01',
    );
    await expect(page.getByRole('checkbox', { name: 'Select TC-00901' })).toBeChecked();
    const captured = page.getByRole('region', { name: 'Captured tools' });
    await expect(captured).toContainText(`Latest run ${run.id.slice(0, 8)} captured these tools:`);
    await expect(captured).toContainText('TC-00901');
    await expect(captured).not.toContainText('TC-00902');
    await expect(agent.getByText('succeeded')).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
