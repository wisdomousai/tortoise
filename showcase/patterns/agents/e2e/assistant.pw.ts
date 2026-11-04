import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

type Host = Awaited<ReturnType<typeof startService>>;

async function submitRequest(host: Host) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const response = await fetch(`${host.origin}/api/v1/commands/test-request.submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      input: {
        sample: 'OS-24-0412',
        transformer: 'TR-40417',
        description: 'Dissolved gas after a Buchholz gas alarm.',
      },
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { result: { id: string } }).result.id;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Assistant' });

async function send(page: Page, message: string) {
  const composer = panel(page).getByRole('textbox', { name: 'Message' });
  await composer.fill(message);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
}

test('the assistant panel runs a conversation with the method suggester and shows it again after a reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-assistant-'));
  const host = await startService('@tortoise/pattern-agents', workspace);
  try {
    const id = await submitRequest(host);
    await page.goto(host.launchUrl);
    await page.goto(`${host.origin}/#/requests/${id}`);
    const assistant = panel(page);
    await expect(assistant.getByRole('heading', { name: 'Test method suggester' })).toBeVisible();
    // The request screen hands its record to the panel, so the next run sees it.
    await expect(assistant.getByRole('group', { name: 'What the next run sees' })).toContainText(
      'OS-24-0412',
    );

    // No model is configured, so the panel runs the deterministic demo, which reads a script.
    const first = JSON.stringify({
      question: 'Which test should the method name?',
      commands: [{ operation: 'test-request.get', input: { input: { id } } }],
      text: 'Read the request.',
    });
    await send(page, first);
    const question = assistant.getByRole('region', { name: 'Question' });
    await expect(question).toContainText('Which test should the method name?');
    await question.getByRole('textbox', { name: 'Answer' }).fill('Dissolved gas analysis');
    await question.getByRole('button', { name: 'Answer' }).click();
    const log = assistant.getByRole('log', { name: 'Conversation' });
    await expect(log).toContainText('Read the request.');
    await expect(log.getByRole('list', { name: 'Calls' })).toContainText('Test request');

    // The host keeps the request, the answer and the reply, so a reload shows the conversation.
    await page.reload();
    await expect(log).toContainText(first);
    await expect(question).toContainText('Answer: Dissolved gas analysis');
    await expect(log).toContainText('Read the request.');

    // A follow-up continues the same conversation.
    await send(page, JSON.stringify({ commands: [], text: 'Second turn.' }));
    await expect(log).toContainText('Second turn.');
    const runs = (await (await page.request.get(`${host.origin}/api/v1/runs`)).json()) as {
      conversationId: string;
      context: { agentId?: string; uiContext?: { selectedResources?: string[] } };
    }[];
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.conversationId)).size).toBe(1);
    expect(runs.every((run) => run.context.agentId === 'test-request.method-suggester')).toBe(true);
    expect(runs[0]!.context.uiContext?.selectedResources).toEqual([`test-request:${id}`]);

    // A new conversation starts empty; the earlier one stays on the host.
    await assistant.getByRole('button', { name: 'New conversation' }).click();
    await expect(log).toHaveCount(0);
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
