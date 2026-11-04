/**
 * The screenshots of the parts desk tutorial (`docs/tutorials/parts-desk-*.mdx`). `prepare.ts`
 * creates the trial records, mara as a supervisor and the draft Q-00001, and the deployment policy of
 * the llama-server stand-in, which plays the assistant from `responder.ts`. The browser logs a
 * call, builds a quote and holds the assistant conversations the pages describe. Run with
 * `bun run docs:screenshots`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { shot } from '../../../../tests/docs/shots';
import { stubRecognizer } from './recognizer';

const app = 'parts-desk';

// The assistant panel narrows every screen, so a wider window keeps the screens whole.
test.use({ viewport: { width: 1440, height: 900 } });
// Playwright's headless shell crashes the page on `SpeechRecognition.available`.
test.beforeEach(({ page }) => stubRecognizer(page));

function prepare(directory: string) {
  const prepared = spawnSync('bun', ['showcase/examples/parts-desk/e2e/prepare.ts', directory], {
    encoding: 'utf8',
  });
  if (prepared.status !== 0) throw new Error(`Preparing the workspace failed: ${prepared.stderr}`);
  return JSON.parse(prepared.stdout.trim().split('\n').at(-1)!) as Record<string, string>;
}

const section = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name }).click();

/** Send a message. The host refuses one while the model server starts, so it is sent again. */
async function send(panel: Locator, text: string) {
  const composer = panel.getByRole('textbox', { name: 'Message' });
  await composer.fill(text);
  await expect(async () => {
    if (await composer.inputValue()) await composer.press('Enter');
    await expect(composer).toHaveValue('', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

test('parts desk tutorial screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'parts-desk-shots-'));
  const env = prepare(directory);
  const host = await startService('@tortoise/parts-desk', env.WORKSPACE_PATH!, env);
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Assistant' });
    // Message times follow the clock.
    const times = panel.locator('time');

    // A call: the caller reads out the first digits, and two transformers match.
    await page.getByRole('textbox', { name: 'Caller', exact: true }).fill('J. Weber');
    await page.getByRole('textbox', { name: 'Serial', exact: true }).fill('TR-404');
    const matches = page.getByRole('list', { name: 'Transformers matching TR-404' });
    await expect(matches.getByRole('button')).toHaveCount(2);
    await shot(page.locator('main'), app, 'inquiries');
    await matches.getByRole('button', { name: /TR-40417/ }).click();
    await page
      .getByRole('textbox', { name: 'Subject', exact: true })
      .fill('Two HV bushings after a flashover');
    await page.getByRole('button', { name: 'Log call' }).click();
    const call = page.getByRole('row', { name: /Two HV bushings after a flashover/ });
    await call.getByRole('link', { name: 'TR-40417' }).click();

    // The transformer, and the panel beside it with the record and the requests it offers.
    await expect(page.getByRole('heading', { name: 'TR-40417', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'HV bushings' })).toContainText('2 in stock');
    await shot(page.locator('main'), app, 'transformer');
    await expect(panel.getByRole('group', { name: 'What the next run sees' })).toContainText(
      'TR-40417 · Stadtwerke Nordhafen',
    );
    await shot(page, app, 'screen-context');

    // The parts lookup and the quote builder with a discount above the desk's limit.
    await page.getByRole('link', { name: 'Find parts' }).click();
    await page.getByRole('tab', { name: 'Bushings' }).click();
    const bushing = page.getByRole('article', { name: 'BSH-145-1250' });
    await bushing.getByRole('button', { name: 'Add to quote' }).click();
    await bushing.getByRole('button', { name: 'Add to quote' }).click();
    await expect(bushing.getByText('2 in quote')).toBeVisible();
    await shot(page.locator('main'), app, 'parts');
    await page.getByRole('link', { name: 'Open quote' }).click();
    await page.getByRole('spinbutton', { name: 'Discount' }).fill('12');
    await expect(page.getByText('Above 10 percent a supervisor must approve.')).toBeVisible();
    await shot(page.locator('main'), app, 'quote-builder');

    // A partial serial: the assistant asks which transformer through the question tool.
    await section(page, 'Inquiries');
    await send(panel, 'A caller from Alpental reads TR-404 off the plate.');
    const question = panel.getByRole('region', { name: 'Question' });
    await expect(question.getByRole('button', { name: 'TR-40471' })).toBeVisible();
    await shot(panel, app, 'assistant-question', { mask: [times] });
    await question.getByRole('button', { name: 'TR-40471' }).click();
    await expect(panel).toContainText('TR-40471 is a PTX-40 of Alpental Energie');

    // A prepared quote: the builder opens filled in, and nothing exists until Create draft.
    await panel.getByRole('button', { name: 'New conversation' }).click();
    await send(panel, 'Prepare a quote of two HV bushings for TR-40417.');
    await expect(page.getByText('The assistant prepared this quote')).toBeVisible();
    await expect(panel).toContainText('I filled in the quote form for TR-40417');
    await shot(page, app, 'prepared-quote', { mask: [times] });

    // 15 percent is above the limit, so the run requests approval from a supervisor.
    await panel.getByRole('button', { name: 'New conversation' }).click();
    await section(page, 'Inquiries');
    await send(panel, 'The utility wants 15 percent off Q-00001 because of a late delivery.');
    const approval = panel.getByRole('region', { name: 'Approval request' });
    await expect(approval).toContainText('Set discount · 15 percent off Q-00001');
    await expect(approval).toContainText('A supervisor must decide.');
    await shot(panel, app, 'assistant-approval', { mask: [times] });
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
