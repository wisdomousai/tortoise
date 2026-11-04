import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { addTool, blur, enroll, scan, sections, signIn } from './counter';

test('the tool screens add, filter and search tools, and the terminal edits, lends and returns one', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-screens-'));
  const host = await startService('@tortoise/tool-store', workspace);
  try {
    await page.goto(host.launchUrl);
    await enroll(page, 'mia@plant', 'E100001', '2468');
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();

    await addTool(page, 'TC-00601', 'Torque wrench 20-100 Nm', 'torque-tool', 'A-03');
    // The list is live: the new row appears without a reload, available and in its bin.
    const wrench = page.getByRole('row', { name: 'TC-00601 Torque wrench 20-100 Nm' });
    await expect(wrench).toBeVisible();
    await expect(wrench).toContainText('A-03');
    await expect(wrench).toContainText('Available');
    await addTool(page, 'TC-00602', 'Crimper 0.5-6 mm2', 'crimper', 'B-01');
    const crimper = page.getByRole('row', { name: 'TC-00602 Crimper 0.5-6 mm2' });
    await expect(crimper).toBeVisible();

    // A duplicate asset tag is refused and shown, and the list keeps two tools.
    await addTool(page, 'TC-00601', 'Copy', 'gauge', 'A-04');
    await expect(page.getByText('A tool with this asset tag exists')).toBeVisible();
    await expect(page.getByRole('row', { name: /^TC-00601/ })).toHaveCount(1);

    // Filters and search go to the list query.
    await page.getByLabel('Filter by category').selectOption('crimper');
    await expect(crimper).toBeVisible();
    await expect(wrench).toHaveCount(0);
    await page.getByLabel('Filter by category').selectOption('');
    await page.getByLabel('Filter by status').selectOption('missing');
    await expect(page.getByText('No tools match.')).toBeVisible();
    await page.getByLabel('Filter by status').selectOption('');
    await page.getByRole('textbox', { name: 'Search tools' }).fill('torque');
    await expect(wrench).toBeVisible();
    await expect(crimper).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search tools' }).fill('00602');
    await expect(crimper).toBeVisible();
    await page.getByRole('textbox', { name: 'Search tools' }).fill('');

    // A row opens its tool at the terminal, which shows it once the attendant signs in.
    await wrench.click();
    await signIn(page, 'E100001', '2468');
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tool TC-00601' })).toBeVisible();
    // Every update field is optional, so the label says so.
    await page.getByRole('textbox', { name: /^Bin/ }).fill('A-04');
    await page.getByRole('textbox', { name: /^Calibration due/ }).fill('2027-03-01');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'A-04' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '2027-03-01' })).toBeVisible();

    // Check out: the form takes the borrower, work order and due time, and the tool is lent.
    await page.getByRole('textbox', { name: 'Borrower' }).fill('E4217');
    await page.getByRole('textbox', { name: 'Work order' }).fill('WO-100');
    await page.getByRole('textbox', { name: 'Due', exact: true }).fill('2026-11-05T16:00:00Z');
    await page.getByRole('button', { name: 'Check out' }).click();
    // The malformed employee number is refused: the tool is still available.
    await expect(page.getByRole('definition').filter({ hasText: 'checked-out' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Borrower' }).fill('E004217');
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'checked-out' })).toBeVisible();
    // The signed-in attendant lent it.
    await expect(page.getByRole('region', { name: 'Open loan', exact: true })).toContainText(
      'mia@plant',
    );
    // A lent tool offers the return form, not a second check-out.
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);
    await page.getByLabel('Condition', { exact: true }).selectOption('damaged');
    await page.getByRole('textbox', { name: /^Note/ }).fill('ratchet slips');
    await page.getByRole('button', { name: 'Return' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'in-repair' })).toBeVisible();
    const past = page
      .getByRole('region', { name: 'Past loans', exact: true })
      .getByRole('row', { name: /^E004217/ });
    await expect(past).toContainText('mia@plant');
    await expect(past).toContainText('damaged');
    // The fake EAM opens a repair order for the damaged return; the tool shows its number.
    await expect(page.getByRole('region', { name: 'Repair order', exact: true })).toContainText(
      'RO-000001',
    );
    await expect(past).toContainText('RO-000001');

    // A reload keeps the attendant signed in at the counter.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();

    // Signing out returns the terminal to sign-in.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Scan your badge')).toBeVisible();

    // The loan is listed and read-only.
    await sections(page).getByRole('link', { name: 'Loans' }).click();
    const loan = page.getByRole('row', { name: /TC-00601/ });
    await expect(loan).toContainText('E004217');
    await expect(loan).toContainText('damaged');
    await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(0);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a tool checked out past its due time is on the Overdue tab until it is returned damaged', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-overdue-'));
  // The demo EAM does not know this tool, so its repair order is refused.
  const host = await startService('@tortoise/tool-store', workspace, {
    DEMO_EAM_UNKNOWN_TAGS: 'TC-00701',
  });
  try {
    await page.goto(host.launchUrl);
    await enroll(page, 'jonas@plant', 'E100002', '8642');
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    await page.getByRole('textbox', { name: 'Asset tag', exact: true }).fill('TC-00701');
    await page
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Insulation tester 5 kV');
    await page.getByLabel('Category', { exact: true }).selectOption('insulation-tester');
    await page.getByRole('textbox', { name: 'Bin', exact: true }).fill('B-02');
    await page.getByRole('textbox', { name: /^Calibration due/ }).fill('2027-01-15');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('row', { name: 'TC-00701 Insulation tester 5 kV' })).toBeVisible();

    // Overdue is no longer a screen of its own: it is a tab at the terminal.
    await expect(sections(page).getByRole('link', { name: 'Overdue' })).toHaveCount(0);
    await sections(page).getByRole('link', { name: 'Terminal' }).click();
    await signIn(page, 'E100002', '8642');
    await expect(page.getByRole('heading', { name: 'jonas@plant', level: 1 })).toBeVisible();

    // A scanned tag opens the tool.
    await blur(page);
    await scan(page, 'TC-00701');

    // The counter shows the tool, and an available tool offers check-out and no return.
    await expect(page.getByRole('heading', { name: 'Tool TC-00701' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'B-02' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '2027-01-15' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'available' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return' })).toHaveCount(0);
    await expect(page.getByText('No past loans.')).toBeVisible();

    // A due time in the past: the loan opens and is overdue at once.
    await page.getByRole('textbox', { name: 'Borrower' }).fill('E004217');
    await page.getByRole('textbox', { name: 'Work order' }).fill('WO-200');
    await page.getByRole('textbox', { name: 'Due', exact: true }).fill('2020-01-01T08:00:00Z');
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'checked-out' })).toBeVisible();
    const openLoan = page.getByRole('region', { name: 'Open loan', exact: true });
    await expect(openLoan).toContainText('E004217');
    await expect(openLoan).toContainText('WO-200');
    await expect(openLoan).toContainText('2020-01-01T08:00:00Z');
    await expect(openLoan).toContainText('jonas@plant');
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);

    // The Overdue tab lists it; its row opens the tool on the Counter tab.
    await page.getByRole('tab', { name: 'Overdue' }).click();
    await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
    const overdue = page.getByRole('row', { name: 'TC-00701 E004217' });
    await expect(overdue).toContainText('Insulation tester 5 kV');
    await expect(overdue).toContainText('WO-200');
    await overdue.click();
    await expect(page.getByRole('heading', { name: 'Tool TC-00701' })).toBeVisible();

    // Return it damaged: the tool goes to repair and the loan moves to the past loans.
    await page.getByLabel('Condition', { exact: true }).selectOption('damaged');
    await page.getByRole('textbox', { name: /^Note/ }).fill('probe lead cut');
    await page.getByRole('button', { name: 'Return' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'in-repair' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Open loan', exact: true })).toHaveCount(0);
    const past = page
      .getByRole('region', { name: 'Past loans', exact: true })
      .getByRole('row', { name: /^E004217/ });
    await expect(past).toContainText('WO-200');
    await expect(past).toContainText('damaged');
    await expect(past).toContainText('probe lead cut');
    await expect(
      page.getByRole('region', { name: 'Repair order', exact: true }).getByRole('alert'),
    ).toContainText('Needs attention: the EAM refused the repair order (ASSET_UNKNOWN');
    await expect(past).toContainText('ASSET_UNKNOWN');
    // A tool in repair offers neither form.
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Return' })).toHaveCount(0);

    // The returned loan has left the Overdue tab.
    await page.getByRole('tab', { name: 'Overdue' }).click();
    await expect(page.getByText('No tools are overdue.')).toBeVisible();

    // The EAM screen counts the refusal and holds nothing for a decision.
    await sections(page).getByRole('link', { name: 'EAM' }).click();
    await expect(page.getByRole('heading', { name: 'EAM', level: 1 })).toBeVisible();
    await expect(page.getByText('No held deliveries.')).toBeVisible();
    await expect(page.getByRole('definition').nth(3)).toHaveText('1');
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the counter scanner opens a tool at the terminal and fills the borrower without submitting', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-scanner-'));
  const host = await startService('@tortoise/tool-store', workspace);
  try {
    await page.goto(host.launchUrl);
    await enroll(page, 'mia@plant', 'E100001', '2468');
    const panel = page.getByRole('complementary', { name: 'Counter scanner' }).getByRole('status');
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    for (const [assetTag, description, category] of [
      ['TC-00801', 'Torque wrench 5-25 Nm', 'torque-tool'],
      ['TC-00802', 'Digital caliper 150 mm', 'gauge'],
    ]) {
      await addTool(page, assetTag!, description!, category!, 'C-01');
      await expect(page.getByRole('row', { name: `${assetTag} ${description}` })).toBeVisible();
    }

    // An unknown code with a row focused: the scan's Enter does not open the row.
    await page.getByRole('row', { name: 'TC-00802 Digital caliper 150 mm' }).focus();
    await scan(page, 'WO-12345');
    await expect(panel).toContainText('WO-12345');
    await expect(panel).toContainText('Unknown code');
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
    // A well-formed tag that no tool carries opens nothing.
    await scan(page, 'TC-09999');
    await expect(panel).toContainText('No tool has this tag.');
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
    // A badge outside the terminal fills nothing.
    await scan(page, 'E004217');
    await expect(panel).toContainText('Lend tools at the terminal.');

    // A tool's tag opens it at the terminal from another screen; the panel pauses there, and
    // the tool shows once the attendant has signed in.
    await sections(page).getByRole('link', { name: 'Loans' }).click();
    await blur(page);
    await scan(page, 'TC-00801');
    await expect(page.getByRole('complementary', { name: 'Counter scanner' })).toContainText(
      'Scanner paused',
    );
    await signIn(page, 'E100001', '2468');
    await expect(page.getByRole('heading', { name: 'Tool TC-00801' })).toBeVisible();
    const scanned = page.getByRole('region', { name: 'Scan a tool' }).getByRole('status');

    // A badge fills the borrower and keeps the work order and due time.
    const borrower = page.getByRole('textbox', { name: 'Borrower' });
    const openLoan = page.getByRole('region', { name: 'Open loan', exact: true });
    await page.getByRole('textbox', { name: 'Work order' }).fill('WO-300');
    await page.getByRole('textbox', { name: 'Due', exact: true }).fill('2026-11-06T16:00:00Z');
    await blur(page);
    await scan(page, 'E004217');
    await expect(borrower).toHaveValue('E004217');
    await expect(page.getByRole('textbox', { name: 'Work order' })).toHaveValue('WO-300');
    await expect(scanned).toContainText('Borrower filled');
    // Scanned into the empty, focused borrower field, the badge completes a valid form, and its
    // Enter still submits nothing. The wait gives a submitted command time to commit.
    await borrower.fill('');
    await borrower.focus();
    await scan(page, 'E004218');
    await expect(borrower).toHaveValue('E004218');
    await expect(scanned).toContainText('E004218');
    await page.waitForTimeout(500);
    await expect(page.getByRole('definition').filter({ hasText: 'available' })).toBeVisible();
    await expect(openLoan).toHaveCount(0);

    // The attendant confirms.
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(openLoan).toContainText('E004218');
    await expect(openLoan).toContainText('WO-300');
    await expect(openLoan).toContainText('mia@plant');

    // A lent tool has no check-out form to take a badge.
    await blur(page);
    await scan(page, 'E004217');
    await expect(scanned).toContainText('Open an available tool to lend it.');
    await expect(openLoan).toContainText('E004218');
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the terminal refuses what is not a badge and a wrong PIN, refuses a viewer a check-out, and signs out after five idle minutes', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-sign-in-'));
  const host = await startService('@tortoise/tool-store', workspace);
  try {
    // The page's clock runs on its own time from here, so the idle timeout can be skipped.
    await page.clock.install();
    await page.goto(host.launchUrl);
    await enroll(page, 'sam@plant', 'E100003', '1357');
    await enroll(page, 'mia@plant', 'E100001', '2468');
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    await addTool(page, 'TC-00901', 'Crimper 0.25-2.5 mm2', 'crimper', 'D-01');
    await expect(page.getByRole('row', { name: 'TC-00901 Crimper 0.25-2.5 mm2' })).toBeVisible();

    await sections(page).getByRole('link', { name: 'Terminal' }).click();
    await expect(page.getByText('Scan your badge')).toBeVisible();
    // An asset tag is not a badge.
    await blur(page);
    await scan(page, 'TC-00901');
    await expect(page.getByText('Not a badge')).toBeVisible();
    // A wrong PIN is refused without saying which part was wrong.
    await signIn(page, 'E100001', '9999');
    await expect(page.getByText('Badge or PIN not recognized')).toBeVisible();
    await page.getByRole('button', { name: 'Scan another badge' }).click();

    // A viewer signs in and reads, but the instance refuses the viewer's check-out.
    await signIn(page, 'E100003', '1357');
    await expect(page.getByRole('heading', { name: 'sam@plant', level: 1 })).toBeVisible();
    await blur(page);
    await scan(page, 'TC-00901');
    await expect(page.getByRole('heading', { name: 'Tool TC-00901' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Borrower' }).fill('E004217');
    await page.getByRole('textbox', { name: 'Work order' }).fill('WO-400');
    await page.getByRole('textbox', { name: 'Due', exact: true }).fill('2026-11-06T16:00:00Z');
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'RESOURCE_DENIED' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'available' })).toBeVisible();
    await page.getByRole('tab', { name: 'Overdue' }).click();
    await expect(page.getByText('No tools are overdue.')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();

    // An attendant left alone for five minutes is signed out, and the next one starts afresh.
    await signIn(page, 'E100001', '2468');
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();
    await page.clock.fastForward('04:50');
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toBeVisible();
    await page.clock.fastForward('00:15');
    await expect(page.getByText('Scan your badge')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'mia@plant', level: 1 })).toHaveCount(0);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('an attendant approves one request to retire a tool and rejects another on the Approvals screen', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tool-store-approvals-'));
  const host = await startService('@tortoise/tool-store', workspace);
  try {
    // The local user's connection token sets up two tools in repair over HTTP and requests their
    // retirement as the repair triage agent would; the launch link signs the browser in as the
    // local user, an attendant.
    const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
    let keys = 0;
    const command = async (operation: string, input: unknown) => {
      const response = await fetch(`${host.origin}/api/v1/commands/${operation}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, idempotencyKey: `setup-${++keys}` }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { result: { id: string } }).result;
    };
    for (const [assetTag, description, note] of [
      ['TC-00901', 'Torque wrench 20-100 Nm', 'Housing cracked through, beyond repair.'],
      ['TC-00902', 'Crimper 0.5-6 mm2', 'Ratchet slips.'],
    ]) {
      const { id: toolId } = await command('tool.create', {
        assetTag,
        description,
        category: 'hand-tool',
        bin: 'D-01',
      });
      await command('tool.check-out', {
        toolId,
        borrower: 'E004217',
        workOrder: 'WO-900',
        dueAt: '2026-11-05T16:00:00Z',
      });
      await command('tool.return', { toolId, condition: 'damaged', note });
      await command('approval.request', {
        operation: 'tool.retire',
        input: { toolId },
        rationale: `${assetTag}: ${note}`,
        resource: `tool:${toolId}`,
      });
    }

    await page.goto(host.launchUrl);
    await sections(page).getByRole('link', { name: 'Approvals' }).click();
    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
    // Each request is named by the tag of the tool it would retire.
    const wrench = page.getByRole('listitem', { name: 'Retire TC-00901' });
    const crimper = page.getByRole('listitem', { name: 'Retire TC-00902' });
    await expect(wrench).toContainText('beyond repair');
    await expect(crimper).toBeVisible();
    await wrench.getByRole('button', { name: 'Approve' }).click();
    await expect(wrench).toHaveCount(0);
    await crimper.getByRole('button', { name: 'Reject' }).click();
    await expect(crimper).toHaveCount(0);
    await expect(page.getByText('No pending approvals.')).toBeVisible();

    // Approving retired the wrench; rejecting left the crimper in repair.
    await sections(page).getByRole('link', { name: 'Tools' }).click();
    await expect(page.getByRole('row', { name: /^TC-00901/ })).toContainText('Retired');
    await expect(page.getByRole('row', { name: /^TC-00902/ })).toContainText('In repair');
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
