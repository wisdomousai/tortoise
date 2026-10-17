import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

/** A call to the authority as the page's own session, as the frame makes it. */
const api = (page: Page, path: string, body: unknown) =>
  page.evaluate(
    async ([path, body]) => {
      const response = await fetch(`/api/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json();
    },
    [path, body] as const,
  );

test('a protocol-handler landing opens the task; a file prefills a task the person adds', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-os-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    host = await startService('@agent-native/project-tasks', workspace);
    const manifest = await (await page.request.get(`${host.origin}/manifest.webmanifest`)).json();
    const protocol: string = manifest.protocol_handlers[0].protocol;
    expect(manifest.protocol_handlers[0].url).toBe('/?os=%s');
    expect(manifest.file_handlers[0].accept['text/markdown']).toEqual(['.md', '.markdown']);

    await page.goto(host.launchUrl);
    await page.getByLabel('New project').fill('Alpha');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    const beta = (await api(page, 'commands/project.create', {
      input: { name: 'Beta' },
      idempotencyKey: 'beta',
    })) as { result: { id: string } };
    const task = (await api(page, 'commands/task.create', {
      input: { projectId: beta.result.id, title: 'Linked task' },
      idempotencyKey: 'linked',
    })) as { result: { id: string } };

    // The browser navigates here when the person follows `web+…://tasks/<id>`.
    await page.goto(
      `${host.origin}/?os=${encodeURIComponent(`${protocol}://tasks/${task.result.id}`)}`,
    );
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await expect(page.getByText('Opened from a link')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');

    await api(page, 'shell/requests', {
      platform: 'web',
      request: { kind: 'file', name: 'Release notes.md', text: 'Ship the beta.' },
    });
    const prefilled = page.getByRole('region', { name: 'Prefilled task' });
    await expect(prefilled.getByText('Opened from a file: Release notes.md')).toBeVisible();
    await expect(prefilled.getByLabel('Title')).toHaveValue('Release notes');
    await expect(prefilled.getByLabel('Description')).toHaveValue('Ship the beta.');
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(prefilled).toBeHidden();
    await expect(page.getByRole('button', { name: 'Release notes', exact: true })).toBeVisible();
  } finally {
    await host?.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
