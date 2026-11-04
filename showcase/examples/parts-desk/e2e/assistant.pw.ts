import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { hear, stubbed, stubRecognizer } from './recognizer';

test.beforeEach(({ page }) => stubRecognizer(page));

/**
 * The workspace and the stand-in's deployment policy for one test, from `prepare.ts`. The spec runs
 * under Node, so a Bun script opens the application to create the records.
 */
function prepare(directory: string) {
  const prepared = spawnSync('bun', ['showcase/examples/parts-desk/e2e/prepare.ts', directory], {
    encoding: 'utf8',
  });
  if (prepared.status !== 0) throw new Error(`Preparing the workspace failed: ${prepared.stderr}`);
  return JSON.parse(prepared.stdout.trim().split('\n').at(-1)!) as Record<string, string>;
}

const assistant = (page: Page) => page.getByRole('complementary', { name: 'Assistant' });

/**
 * Send what the composer holds with Enter. The host refuses a message while the model server is
 * still starting, and the panel keeps a refused message in the composer, so it is sent again until
 * the composer empties.
 */
async function submit(panel: Locator) {
  const composer = panel.getByRole('textbox', { name: 'Message' });
  await expect(async () => {
    if (await composer.inputValue()) await composer.press('Enter');
    await expect(composer).toHaveValue('', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}
async function send(panel: Locator, text: string) {
  await panel.getByRole('textbox', { name: 'Message' }).fill(text);
  await submit(panel);
}

interface RunView {
  createdAt: string;
  conversationId: string;
  context: {
    agentId?: string;
    uiContext?: {
      sessionId?: string;
      selectedResources?: string[];
      observedRevisions?: Record<string, number>;
    };
  };
}
const runsOf = async (page: Page, origin: string) =>
  (await (await page.request.get(`${origin}/api/v1/runs`)).json()) as RunView[];

test('the assistant panel finds TR-40417, asks which transformer TR-404 means and shows the approval request for 15 percent', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'parts-desk-assistant-'));
  const env = prepare(directory);
  const host = await startService('@tortoise/parts-desk', env.WORKSPACE_PATH!, env);
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    const panel = assistant(page);
    // Before the first message the panel offers three requests.
    await expect(panel.getByRole('button', { name: /^A caller reads TR-40417/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Which HV bushings/ })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: /^The utility wants 15 percent/ }),
    ).toBeVisible();

    // A whole serial: the find is a query chip, and the serial in the answer links its screen.
    await send(panel, 'A caller reads TR-40417 off the rating plate. Which transformer is it?');
    const log = panel.getByRole('log', { name: 'Conversation' });
    const find = log.getByRole('listitem').filter({ hasText: 'Find transformer' });
    await expect(find.getByLabel('Done')).toBeVisible();
    await expect(find.getByLabel('Query')).toBeVisible();
    await expect(log).toContainText('TR-40417 is a PTX-40 of Stadtwerke Nordhafen');
    await log.getByRole('link', { name: 'TR-40417' }).click();
    await expect(page.getByRole('heading', { name: 'TR-40417', level: 1 })).toBeVisible();

    // A partial serial in a follow-up: the run asks which transformer, and the answer continues it.
    await send(panel, 'A caller from Alpental reads TR-404 off the plate.');
    const question = log.getByRole('region', { name: 'Question' });
    await expect(question).toContainText(
      'TR-404 matches TR-40417 (Stadtwerke Nordhafen) and TR-40471 (Alpental Energie).',
    );
    await question.getByRole('button', { name: 'TR-40471' }).click();
    await expect(question).toContainText('Answered TR-40471');
    await expect(log).toContainText('TR-40471 is a PTX-40 of Alpental Energie');

    // 15 percent is above the desk's limit, so the run requests approval; the local user is at the
    // desk, not a supervisor, so the card says who decides instead of offering Approve.
    await send(panel, 'The utility wants 15 percent off Q-00001 because of a late delivery.');
    const approval = log.getByRole('region', { name: 'Approval request' });
    await expect(approval).toContainText('Set discount · 15 percent off Q-00001');
    await expect(approval).toContainText('Reason: A late delivery');
    await expect(approval).toContainText(
      'The utility wants 15 percent off Q-00001 because of a late delivery.',
    );
    await expect(approval).toContainText('pending');
    await expect(approval).toContainText('A supervisor must decide.');
    await expect(approval.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(log).toContainText('I requested approval for 15 percent off Q-00001.');
    await log.getByRole('link', { name: 'Q-00001' }).click();
    await expect(page.getByRole('heading', { name: 'Quote Q-00001' })).toBeVisible();

    // The three messages are one conversation of the assistant, from the panel's UI session.
    const runs = await runsOf(page, host.origin);
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((run) => run.conversationId)).size).toBe(1);
    expect(runs.every((run) => run.context.agentId === 'parts-desk.assistant')).toBe(true);
    expect(new Set(runs.map((run) => run.context.uiContext?.sessionId)).size).toBe(1);

    // New conversation clears the panel. The quote screen offers its own requests, so the
    // examples give way to them.
    await panel.getByRole('button', { name: 'New conversation' }).click();
    await expect(log).toHaveCount(0);
    await expect(
      panel
        .getByRole('list', { name: 'Requests from the screen' })
        .getByRole('button', { name: 'Which parts on Q-00001 are in stock?' }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: /^A caller reads TR-40417/ })).toHaveCount(0);
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the assistant panel sees TR-40417 on its screen, offers its requests and names it in the run until it is left out', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'parts-desk-context-'));
  const env = prepare(directory);
  const host = await startService('@tortoise/parts-desk', env.WORKSPACE_PATH!, env);
  try {
    await page.goto(host.launchUrl);
    const panel = assistant(page);
    const context = panel.getByRole('group', { name: 'What the next run sees' });
    const requests = panel.getByRole('list', { name: 'Requests from the screen' });
    // The Inquiries screen with no call selected hands the panel no record.
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    await expect(context).toHaveCount(0);
    await expect(requests).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Transformers' })
      .click();
    await page.getByRole('row', { name: /TR-40417/ }).click();
    await expect(page.getByRole('heading', { name: 'TR-40417', level: 1 })).toBeVisible();
    await expect(context).toContainText('Sees');
    await expect(context).toContainText('TR-40417 · Stadtwerke Nordhafen');
    await expect(requests.getByRole('button')).toHaveText([
      'Which HV bushings fit TR-40417?',
      'Which tap changer parts fit TR-40417, and are they in stock?',
      'Which quotes are open for TR-40417?',
    ]);
    await expect(panel.getByRole('button', { name: /^A caller reads TR-40417/ })).toHaveCount(0);

    // A request fills the composer for the person to change or send.
    await requests.getByRole('button', { name: 'Which HV bushings fit TR-40417?' }).click();
    const composer = panel.getByRole('textbox', { name: 'Message' });
    await expect(composer).toHaveValue('Which HV bushings fit TR-40417?');
    await expect(composer).toBeFocused();
    await submit(panel);
    const log = panel.getByRole('log', { name: 'Conversation' });
    await expect(log).toContainText('These HV bushings fit TR-40417:');
    await expect(log).toContainText('BSH-145-1250');

    // The run's UI context names the transformer, at the revision 0 its read allows.
    const found = (await (
      await page.request.post(`${host.origin}/api/v1/queries/transformer.find`, {
        headers: { origin: host.origin },
        data: { input: { serial: 'TR-40417' } },
      })
    ).json()) as { data: { items: { id: string; serial: string }[] } };
    const id = found.data.items.find((item) => item.serial === 'TR-40417')!.id;
    let runs = await runsOf(page, host.origin);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.context.uiContext).toMatchObject({
      selectedResources: [`transformer:${id}`],
      observedRevisions: { [`transformer:${id}`]: 0 },
    });

    // Left out, the screen offers no requests and the next run's context names no record.
    await context.getByRole('button', { name: 'Leave out of the next run' }).click();
    await expect(context).toContainText('Left out');
    await expect(requests).toHaveCount(0);
    await send(panel, 'Which transformer is TR-40417?');
    await expect(log).toContainText('TR-40417 is a PTX-40 of Stadtwerke Nordhafen');
    runs = (await runsOf(page, host.origin)).toSorted((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    expect(runs).toHaveLength(2);
    expect(runs[1]!.context.uiContext?.selectedResources).toEqual([]);
    expect(new Set(runs.map((run) => run.context.uiContext?.sessionId)).size).toBe(1);

    await context.getByRole('button', { name: 'Include' }).click();
    await expect(context).toContainText('Sees');
    await expect(requests.getByRole('button')).toHaveCount(3);
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

/** Run a query of the instance as the signed-in person, as a screen does. */
async function query<T>(page: Page, origin: string, operation: string, input: unknown) {
  const response = await page.request.post(`${origin}/api/v1/queries/${operation}`, {
    headers: { origin },
    data: { input },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

interface RunEvents {
  events: { type: string; operation?: string }[];
}

/**
 * Start a scripted run on the deterministic harness from the panel's UI session, so its `ui.*`
 * calls reach the panel as a model's would, and wait until it ends.
 */
async function scripted(page: Page, origin: string, uiSessionId: string, commands: unknown[]) {
  const started = await page.request.post(`${origin}/api/v1/runs`, {
    headers: { origin },
    data: { harnessId: 'deterministic', prompt: JSON.stringify({ commands }), uiSessionId },
  });
  expect(started.status()).toBe(202);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(async () => {
      const runs = (await runsOf(page, origin)) as unknown as { id: string; state: string }[];
      return runs.find((run) => run.id === id)?.state;
    })
    .toBe('succeeded');
}

test('the assistant prepares a quote of two HV bushings for TR-40417 in the quote builder, the person creates the draft, and the panel opens and selects what a run asks for', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'parts-desk-prepare-'));
  const env = prepare(directory);
  const host = await startService('@tortoise/parts-desk', env.WORKSPACE_PATH!, env);
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    const panel = assistant(page);
    await send(panel, 'Prepare a quote of two HV bushings for TR-40417.');

    // The run fills the form of quote.create, and the panel opens the builder for TR-40417.
    await expect(page.getByRole('heading', { name: 'New quote', level: 1 })).toBeVisible();
    await expect(page.getByText('The assistant prepared this quote')).toBeVisible();
    const lines = page.getByRole('row', { name: /BSH-145-1250/ });
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText('HV bushing 145 kV 1250 A, OIP');
    await expect(page.getByRole('textbox', { name: 'Quantity of BSH-145-1250' })).toHaveValue('2');
    await expect(lines).toContainText('€29,600.00');

    // The chip names the form it filled and links the builder; the run's text follows.
    const log = panel.getByRole('log', { name: 'Conversation' });
    const filled = log.getByRole('listitem').filter({ hasText: 'Filled New Quote for' });
    await expect(filled.getByRole('link', { name: 'TR-40417, 1 line' })).toBeVisible();
    await expect(filled.getByLabel('Done')).toBeVisible();
    await expect(
      log.getByRole('listitem').filter({ hasText: 'Find transformer' }).getByLabel('Done'),
    ).toBeVisible();
    await expect(log).toContainText(
      'I filled in the quote form for TR-40417 with 2 × BSH-145-1250',
    );

    // The run created nothing: Q-00001 from the preparation is still the only quote.
    const before = await query<{ total: number }>(page, host.origin, 'quote.list', {});
    expect(before.total).toBe(1);
    const runs = (await runsOf(page, host.origin)) as unknown as RunEvents[];
    expect(runs).toHaveLength(1);
    expect(
      runs[0]!.events.filter((event) => event.type === 'tool-finish').map((e) => e.operation),
    ).toEqual(['transformer.find', 'part.search', 'ui.prepare']);

    // The person creates the draft from the builder, and the notice is gone.
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { name: 'Quote Q-00002' })).toBeVisible();
    await expect(page.getByText('The assistant prepared this quote')).toHaveCount(0);
    const created = await query<{ items: { id: string; number: string; createdBy: string }[] }>(
      page,
      host.origin,
      'quote.list',
      { search: 'Q-00002' },
    );
    const quote = created.items.find((item) => item.number === 'Q-00002')!;
    expect(quote).toMatchObject({ createdBy: 'local-user' });
    // A run acts as the person who started it too, so the audit log tells them apart: the
    // person's command came through the screen's HTTP session, with no run.
    const audit = await query<{
      items: { operation?: string; resources?: string[]; actor?: Record<string, string> }[];
    }>(page, host.origin, 'compliance.events.list', { kinds: ['command.committed'], newest: true });
    const committed = audit.items.filter((event) => event.operation === 'quote.create');
    expect(committed.at(-1)).toMatchObject({
      resources: expect.arrayContaining([`quote:${quote.id}`]),
      actor: { principalId: 'local-user', via: 'http' },
    });
    expect(committed.at(-1)!.actor).not.toHaveProperty('runId');
    expect(
      (await runsOf(page, host.origin)).every((run) =>
        (run as unknown as RunEvents).events.every((event) => event.operation !== 'quote.create'),
      ),
    ).toBe(true);

    // Asked again, the builder opens filled in once more; Discard drops the prepared form and
    // leaves the desk's own unsaved quote for TR-40417, which has no lines.
    await send(panel, 'Prepare a quote of two HV bushings for TR-40417.');
    await expect(page.getByText('The assistant prepared this quote')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Quantity of BSH-145-1250' })).toHaveValue('2');
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('The assistant prepared this quote')).toHaveCount(0);
    await expect(page.getByText('No lines yet. Add parts from the lookup.')).toBeVisible();
    await expect(
      log.getByRole('listitem').filter({ hasText: 'Filled New Quote for' }).getByLabel('Done'),
    ).toHaveCount(2);
    expect((await query<{ total: number }>(page, host.origin, 'quote.list', {})).total).toBe(2);

    // A run's ui.open opens the record's screen, and its ui.select selects a part the parts
    // lookup shows, as the person's checkbox does.
    const sessionId = (await runsOf(page, host.origin))[0]!.context.uiContext!.sessionId!;
    const found = await query<{ items: { id: string; serial: string }[] }>(
      page,
      host.origin,
      'transformer.find',
      { serial: 'TR-40417' },
    );
    const transformer = found.items.find((item) => item.serial === 'TR-40417')!;
    await scripted(page, host.origin, sessionId, [
      { operation: 'ui.open', input: { input: { resource: `transformer:${transformer.id}` } } },
    ]);
    await expect(page.getByRole('heading', { name: 'TR-40417', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Find parts' }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Select BSH-145-1250' });
    await expect(checkbox).not.toBeChecked();
    const parts = await query<{ items: { id: string; partNumber: string }[] }>(
      page,
      host.origin,
      'part.search',
      { transformerSerial: 'TR-40417', text: 'BSH-145-1250' },
    );
    const bushing = parts.items.find((item) => item.partNumber === 'BSH-145-1250')!;
    await scripted(page, host.origin, sessionId, [
      { operation: 'ui.select', input: { input: { resource: `part:${bushing.id}` } } },
    ]);
    await expect(checkbox).toBeChecked();
    await expect(panel.getByRole('group', { name: 'What the next run sees' })).toContainText('+1');
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the assistant panel resizes between 320 and 640 pixels, keeps its width, collapses to a rail and opens as a sheet on a compact viewport', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'parts-desk-panel-'));
  const host = await startService('@tortoise/parts-desk', workspace);
  try {
    await page.goto(host.launchUrl);
    const panel = assistant(page);
    const edge = panel.getByRole('separator', { name: 'Resize assistant' });
    /** Drag the panel's left edge by `dx` pixels; to the left widens it. */
    const drag = async (dx: number) => {
      const box = (await edge.boundingBox())!;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, { steps: 5 });
      await page.mouse.up();
    };
    await expect(edge).toHaveAttribute('aria-valuenow', '384');
    await drag(-100);
    await expect(edge).toHaveAttribute('aria-valuenow', '484');
    expect(Math.round((await panel.boundingBox())!.width)).toBe(484);
    // The width stays between 320 and 640 however far the edge goes, and the page remembers it.
    await drag(400);
    await expect(edge).toHaveAttribute('aria-valuenow', '320');
    await drag(-500);
    await expect(edge).toHaveAttribute('aria-valuenow', '640');
    await page.reload();
    await expect(edge).toHaveAttribute('aria-valuenow', '640');
    await edge.focus();
    await page.keyboard.press('ArrowRight');
    await expect(edge).toHaveAttribute('aria-valuenow', '624');

    // Shift+Enter breaks the line in the composer instead of sending.
    const composer = panel.getByRole('textbox', { name: 'Message' });
    await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    await composer.fill('Two HV bushings');
    await composer.press('Shift+Enter');
    await composer.pressSequentially('for TR-40417');
    await expect(composer).toHaveValue('Two HV bushings\nfor TR-40417');
    await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled();

    await panel.getByRole('button', { name: 'Collapse assistant' }).click();
    await expect(panel.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    expect(Math.round((await panel.boundingBox())!.width)).toBeLessThan(60);
    await panel.getByRole('button', { name: 'Open assistant' }).click();
    await expect(panel.getByRole('textbox', { name: 'Message' })).toBeVisible();

    // A tablet in portrait: the panel leaves the side and opens from the bar as a sheet.
    await page.setViewportSize({ width: 800, height: 1100 });
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const sheet = page.getByRole('dialog', { name: 'Assistant' });
    await expect(sheet.getByRole('textbox', { name: 'Message' })).toBeVisible();
    expect(Math.round((await sheet.boundingBox())!.height)).toBe(1100);
    await sheet.getByRole('button', { name: 'Close assistant' }).click();
    await expect(sheet).toBeHidden();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the composer offers dictation only with on-device recognition for English, and dictated words fill the message without sending it', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'parts-desk-dictation-'));
  const host = await startService('@tortoise/parts-desk', workspace);
  try {
    const panel = assistant(page);
    const composer = panel.getByRole('textbox', { name: 'Message' });
    const microphone = panel.getByRole('button', { name: /^(Dictate|Stop dictation)$/ });

    // A browser without speech recognition (the stub of every test), and one that offers English
    // only through a service.
    await page.goto(host.launchUrl);
    await expect(composer).toBeVisible();
    await expect(microphone).toHaveCount(0);
    await stubRecognizer(page, 'unavailable');
    await page.reload();
    await expect(composer).toBeVisible();
    expect(await stubbed(page, 'checked')).toEqual([{ langs: ['en-US'], processLocally: true }]);
    await expect(microphone).toHaveCount(0);

    // On-device English: the interim words fill the message after what it held, the button
    // pulses while it listens, and nothing is sent.
    await stubRecognizer(page, 'available');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inquiries', level: 1 })).toBeVisible();
    await composer.fill('Caller says:');
    await panel.getByRole('button', { name: 'Dictate' }).click();
    const stop = panel.getByRole('button', { name: 'Stop dictation' });
    await expect(stop).toHaveAttribute('aria-pressed', 'true');
    await expect(stop.locator('.animate-ping')).toHaveClass(/ring-primary/);
    expect(await stubbed(page, 'started')).toEqual([
      { lang: 'en-US', continuous: true, interimResults: true, processLocally: true },
    ]);
    await hear(page, ['two HV']);
    await expect(composer).toHaveValue('Caller says: two HV');
    await hear(page, ['two HV bushings', ' for TR-40417']);
    await expect(composer).toHaveValue('Caller says: two HV bushings for TR-40417');
    await stop.click();
    await expect(panel.getByRole('button', { name: 'Dictate' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(panel.locator('.animate-ping')).toHaveCount(0);

    // The person edits the words; typing while it listens aborts dictation and keeps the edit.
    await panel.getByRole('button', { name: 'Dictate' }).click();
    await composer.press('End');
    await composer.pressSequentially(', urgent');
    await expect(panel.getByRole('button', { name: 'Dictate' })).toBeVisible();
    expect(await stubbed(page, 'aborted')).toBe(1);
    await expect(composer).toHaveValue('Caller says: two HV bushings for TR-40417, urgent');
    await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(await runsOf(page, host.origin)).toHaveLength(0);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
