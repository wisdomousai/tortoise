import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { stubRecognizer } from './recognizer';

// The panel's composer would ask the headless shell for speech recognition, which crashes it.
test.beforeEach(({ page }) => stubRecognizer(page));

const section = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name }).click();

async function addUtility(page: Page, account: string, name: string, phone: string) {
  await page.getByRole('textbox', { name: 'Account', exact: true }).fill(account);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Phone', exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Create' }).click();
}

/**
 * Create the trial records in `workspace` through the commands, as a development launch does:
 * `dev.ts` opens the workspace, seeds it and closes it before the service starts on it.
 */
function seedTrialRecords(workspace: string) {
  const seed = spawnSync('bun', ['showcase/examples/parts-desk/dev.ts'], {
    env: { ...process.env, WORKSPACE_PATH: workspace },
    encoding: 'utf8',
  });
  if (seed.status !== 0) throw new Error(`Seeding the trial records failed: ${seed.stderr}`);
}

test('the default customer screens add a utility, and the Inquiries screen logs and closes its call', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'parts-desk-screens-'));
  const host = await startService('@agent-native/parts-desk', workspace);
  try {
    await page.goto(host.launchUrl);
    await section(page, 'Customers');
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await addUtility(page, 'U1042', 'Stadtwerke Nordhafen', '+49 40 5550 1042');
    // The list is live: the new row appears without a reload, under its account.
    const row = page.getByRole('row', { name: 'U1042' });
    await expect(row).toBeVisible();
    // A second utility with the same account is refused by the instance.
    await addUtility(page, 'U1042', 'Copy', '+49 40 5550 0000');
    await expect(page.getByText('Customer account U1042 is in use')).toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: 'Customer U1042' })).toBeVisible();

    await section(page, 'Inquiries');
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    await page.getByRole('textbox', { name: 'Caller', exact: true }).fill('J. Weber');
    await page
      .getByRole('combobox', { name: 'Utility' })
      .selectOption({ label: 'Stadtwerke Nordhafen (U1042)' });
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Bushing for phase 2');
    await page.getByRole('button', { name: 'Log call' }).click();
    const call = page.getByRole('row', { name: /Bushing for phase 2/ });
    await expect(call).toBeVisible();
    await expect(call).toContainText('Stadtwerke Nordhafen');
    // A call without a serial cannot be quoted yet; closing it moves it to Closed.
    await expect(call.getByRole('button', { name: 'Quote' })).toBeDisabled();
    await call.getByRole('button', { name: 'Close' }).click();
    await expect(call).toHaveCount(0);
    await page.getByRole('tab', { name: /Closed/ }).click();
    await expect(page.getByRole('row', { name: /Bushing for phase 2/ })).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the desk opens TR-40417 from a call, quotes two HV bushings at 8 percent and submits the quote', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'parts-desk-quote-'));
  seedTrialRecords(workspace);
  const host = await startService('@agent-native/parts-desk', workspace);
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();

    // The caller reads out the first digits; two transformers match, so the desk asks which.
    await page.getByRole('textbox', { name: 'Caller', exact: true }).fill('J. Weber');
    await page.getByRole('textbox', { name: 'Serial', exact: true }).fill('TR-404');
    const matches = page.getByRole('list', { name: 'Transformers matching TR-404' });
    await expect(matches.getByRole('button')).toHaveCount(2);
    await matches.getByRole('button', { name: /TR-40417/ }).click();
    await expect(
      page.getByRole('combobox', { name: 'Utility' }).locator('option:checked'),
    ).toHaveText('Stadtwerke Nordhafen (U1042)');
    await page
      .getByRole('textbox', { name: 'Subject', exact: true })
      .fill('Two HV bushings after a flashover');
    await page.getByRole('button', { name: 'Log call' }).click();
    const call = page.getByRole('row', { name: /Two HV bushings after a flashover/ });
    await call.getByRole('link', { name: 'TR-40417' }).click();

    // The transformer: its rating plate, and the parts that fit each assembly with their stock.
    await expect(page.getByRole('heading', { name: 'TR-40417', level: 1 })).toBeVisible();
    await expect(page.getByText('Nordhafen Ost')).toBeVisible();
    const hv = page.getByRole('region', { name: 'HV bushings' });
    await expect(hv.getByText('BSH-145-1250')).toBeVisible();
    await expect(hv.getByText('2 in stock')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Protection' }).getByText('Out of stock'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Find parts' }).click();

    // The parts lookup, filtered to the parts that fit TR-40417.
    await expect(page.getByRole('heading', { name: 'Parts', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: 'Bushings' }).click();
    const bushing = page.getByRole('article', { name: 'BSH-145-1250' });
    await bushing.getByRole('button', { name: 'Add to quote' }).click();
    await bushing.getByRole('button', { name: 'Add to quote' }).click();
    await expect(bushing.getByText('2 in quote')).toBeVisible();
    await page.getByRole('link', { name: 'Open quote' }).click();

    // The quote builder: two bushings at 14,800.00, and the desk's discount limit.
    await expect(page.getByRole('heading', { name: 'New quote' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Quantity of BSH-145-1250' })).toHaveValue('2');
    await expect(page.getByRole('row', { name: /BSH-145-1250/ })).toContainText('€29,600.00');
    const discount = page.getByRole('spinbutton', { name: 'Discount' });
    await discount.fill('12');
    await expect(page.getByText('Above 10 percent a supervisor must approve.')).toBeVisible();
    await discount.fill('8');
    await expect(page.getByText('Above 10 percent a supervisor must approve.')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Reason' }).fill('Framework agreement 2026');
    await expect(page.getByText('€27,232.00')).toBeVisible();
    await page.getByRole('button', { name: 'Create draft' }).click();

    // quote.create and quote.discount committed: a numbered draft with the discount.
    await expect(page.getByRole('heading', { name: 'Quote Q-00001' })).toBeVisible();
    await expect(page.getByText('draft', { exact: true })).toBeVisible();
    await expect(discount).toHaveValue('8');
    await expect(page.getByText('€27,232.00')).toBeVisible();
    // The screen's Submit, not the assistant panel's request to submit the quote.
    await page.getByRole('main').getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('submitted', { exact: true })).toBeVisible();

    // The quote answered the call, so the inquiry is quoted.
    await section(page, 'Inquiries');
    await page.getByRole('tab', { name: /Quoted/ }).click();
    await expect(
      page.getByRole('row', { name: /Two HV bushings after a flashover/ }),
    ).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
