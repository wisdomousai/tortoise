/**
 * The screenshots of the tool store tutorial (`docs/tutorials/tool-store-*.mdx`). The owner's
 * connection token seeds tools, loans and requests over HTTP with fixed dates; the browser signs
 * an attendant in at the terminal as the pages describe. Run with `bun run docs:screenshots`.
 */
import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { bearerOf, command, shot } from '../../../../tests/docs/shots';
import { blur, enroll, scan, sections, signIn } from './counter';

const app = 'tool-store';

const tools = [
  ['TC-00601', 'Torque wrench 20-100 Nm', 'torque-tool', 'A-03', '2026-12-01'],
  ['TC-00602', 'Insulation tester 5 kV', 'insulation-tester', 'B-01', '2027-01-15'],
  ['TC-00603', 'Crimper 0.5-6 mm2', 'crimper', 'C-02', undefined],
  ['TC-00604', 'Dial gauge 0-10 mm', 'gauge', 'A-03', '2027-03-01'],
  ['TC-00605', 'Cordless drill 18 V', 'power-tool', 'D-01', undefined],
] as const;

// The scanner panel sits beside every screen, so a wider window keeps the tables whole.
test.use({ viewport: { width: 1440, height: 900 } });

test('tool store tutorial screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-shots-'));
  const host = await startService('@tortoise/tool-store', workspace);
  try {
    const token = await bearerOf(host.connectionFile);
    const run = async (id: string, input: Record<string, unknown>, key: string) =>
      ((await command(host.origin, token, id, input, key)) as { result: { id: string } }).result;
    const ids: Record<string, string> = {};
    for (const [assetTag, description, category, bin, calibrationDue] of tools)
      ids[assetTag] = (
        await run(
          'tool.create',
          { assetTag, description, category, bin, ...(calibrationDue ? { calibrationDue } : {}) },
          `create-${assetTag}`,
        )
      ).id;
    // An overdue loan, a tool in repair with a request to retire it, and a handover entry.
    await run(
      'tool.check-out',
      {
        toolId: ids['TC-00602'],
        borrower: 'E004217',
        workOrder: 'WO-58812',
        dueAt: '2026-10-30T14:00:00Z',
      },
      'lend-tester',
    );
    await run(
      'tool.check-out',
      {
        toolId: ids['TC-00605'],
        borrower: 'E104233',
        workOrder: 'WO-58790',
        dueAt: '2026-10-28T16:00:00Z',
      },
      'lend-drill',
    );
    await run(
      'tool.return',
      { toolId: ids['TC-00605'], condition: 'damaged', note: 'Chuck cracked, beyond repair.' },
      'return-drill',
    );
    await run(
      'approval.request',
      {
        operation: 'tool.retire',
        input: { toolId: ids['TC-00605'] },
        rationale: 'TC-00605: the note of its latest return says it is beyond repair.',
        resource: `tool:${ids['TC-00605']}`,
      },
      'retire-drill',
    );
    await run(
      'handover.record',
      { shift: 'early', text: 'Torque wrench TC-00601 back from calibration, shelved in A-03.' },
      'handover-1',
    );
    await run(
      'assignment.cycle-count.create',
      { title: 'Bin A-03', scope: { bin: 'A-03' } },
      'count-a03',
    );

    await page.goto(host.launchUrl);
    await enroll(page, 'mia@plant', 'E100001', '2468');

    await sections(page).getByRole('link', { name: 'Tools' }).click();
    await expect(page.getByRole('row', { name: /^TC-00605/ })).toContainText('In repair');
    await shot(page.locator('main'), app, 'tools');

    await sections(page).getByRole('link', { name: 'Handover' }).click();
    await expect(page.getByText('back from calibration')).toBeVisible();
    await shot(page.locator('main'), app, 'handover');

    await sections(page).getByRole('link', { name: 'Approvals' }).click();
    await expect(page.getByRole('listitem', { name: 'Retire TC-00605' })).toBeVisible();
    await shot(page.locator('main'), app, 'approvals');

    await sections(page).getByRole('link', { name: 'EAM' }).click();
    await expect(page.getByRole('heading', { name: 'EAM', level: 1 })).toBeVisible();
    // The dispatcher sends the drill's repair order within a second; the fake EAM accepts it.
    await expect(page.getByRole('definition').nth(2)).toHaveText('1');
    await shot(page.locator('main'), app, 'eam');

    await sections(page).getByRole('link', { name: 'Cycle counts', exact: true }).click();
    await expect(page.getByText('Bin A-03').first()).toBeVisible();
    await shot(page.locator('main'), app, 'cycle-counts');

    await sections(page).getByRole('link', { name: 'Terminal' }).click();
    await expect(page.getByText('Scan your badge')).toBeVisible();
    await shot(page.locator('main'), app, 'terminal-sign-in');
    await signIn(page, 'E100001', '2468');
    // The session's end follows the clock.
    const clock = page.getByText(/^Signed in at counter until/);
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();

    await blur(page);
    await scan(page, 'TC-00601');
    await expect(page.getByRole('heading', { name: 'Tool TC-00601' })).toBeVisible();
    await blur(page);
    await scan(page, 'E004217');
    await expect(page.getByRole('textbox', { name: 'Borrower' })).toHaveValue('E004217');
    await shot(page.locator('main'), app, 'counter', { mask: [clock] });

    await page.getByRole('tab', { name: 'Overdue' }).click();
    await expect(page.getByRole('row', { name: 'TC-00602 E004217' })).toBeVisible();
    await shot(page.locator('main'), app, 'overdue', { mask: [clock] });

    // The damaged return of the drill shows the repair order the fake EAM opened.
    await blur(page);
    await scan(page, 'TC-00605');
    await expect(page.getByRole('region', { name: 'Repair order', exact: true })).toContainText(
      'RO-',
    );
    await shot(page.locator('main'), app, 'repair-order', { mask: [clock] });

    // A demo run on the ticked wrench opens it and asks for a review of its bin.
    await page.getByRole('tab', { name: 'Tools' }).click();
    await page.getByRole('checkbox', { name: 'Select TC-00601' }).click();
    await expect(page.getByRole('checkbox', { name: 'Select TC-00601' })).toBeChecked();
    await page.getByRole('button', { name: 'Pull for calibration' }).click();
    const review = page.getByRole('region', { name: 'Agent review' });
    await expect(review).toContainText('Pull TC-00601 for calibration');
    await shot(page.locator('main'), app, 'agent-review', {
      mask: [clock, review.locator('.font-mono')],
    });
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
