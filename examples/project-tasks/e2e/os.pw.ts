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

test('a protocol-handler landing opens the task; files and shares prefill tasks the person adds; a reminder waits; a shortcut starts a task', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-os-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    host = await startService('@agent-native/project-tasks', workspace);
    const manifest = await (await page.request.get(`${host.origin}/manifest.webmanifest`)).json();
    const protocol: string = manifest.protocol_handlers[0].protocol;
    expect(manifest.protocol_handlers[0].url).toBe('/?os=%s');
    const accepted = Object.assign(
      {},
      ...manifest.file_handlers.map((handler: { accept: object }) => handler.accept),
    );
    expect(accepted['text/markdown']).toEqual(['.md', '.markdown']);
    expect(accepted['application/pdf']).toEqual(['.pdf']);

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

    // An image is uploaded first, as the shell does, and prefills a task with it attached.
    const blob = await page.evaluate(async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const response = await fetch('/api/v1/blobs', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      return response.json();
    });
    await api(page, 'shell/requests', {
      platform: 'web',
      request: { kind: 'file', name: 'Receipt.png', mediaType: 'image/png', blob },
    });
    await expect(prefilled.getByText('Opened from a file: Receipt.png')).toBeVisible();
    await expect(prefilled.getByText('Attachment: image/png, 1 KB')).toBeVisible();
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(prefilled).toBeHidden();
    const attachment = page.getByRole('link', { name: 'Download the attachment of Receipt' });
    const href = await attachment.getAttribute('href');
    const downloaded = await page.evaluate(async (href) => {
      const response = await fetch(href!);
      return [...new Uint8Array(await response.arrayBuffer())];
    }, href);
    expect(downloaded).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Another app shares to the installed app: the browser posts the share target form as a
    // top-level navigation from no site, and the landing page claims it as its own session.
    const target = manifest.share_target as { action: string; params: { files: unknown[] } };
    expect(target).toMatchObject({ method: 'POST', enctype: 'multipart/form-data' });
    const share = async (
      fields: string,
      file?: { name: string; mimeType: string; buffer: Buffer },
    ) => {
      await page.goto('about:blank');
      await page.setContent(
        `<form method="post" enctype="multipart/form-data" action="${host!.origin}${target.action}">` +
          `${fields}<input type="file" name="file"><button>Share</button></form>`,
      );
      if (file) await page.setInputFiles('input[type=file]', file);
      await page.getByRole('button', { name: 'Share' }).click();
    };
    await share(
      '<input name="title" value="Spec"><input name="url" value="https://example.com/spec">',
    );
    await expect(prefilled.getByText('Shared from another app')).toBeVisible();
    await expect(prefilled.getByLabel('Description')).toHaveValue('https://example.com/spec');
    expect(new URL(page.url()).search).toBe('');
    await prefilled.getByLabel('Title').fill('Read the spec');
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(page.getByRole('button', { name: 'Read the spec', exact: true })).toBeVisible();

    // A web page shows no notifications: the reminder waits for the desktop or phone app.
    const spec = page.getByTestId('task-row').filter({ hasText: 'Read the spec' });
    await spec.hover();
    await spec.getByRole('button', { name: 'Remind me about Read the spec' }).click();
    await expect(spec.getByText('Reminder waiting for the desktop or phone app')).toBeVisible();

    await share('', {
      name: 'Whiteboard.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(prefilled.getByText('Shared from another app')).toBeVisible();
    await expect(prefilled.getByLabel('Title')).toHaveValue('Whiteboard.png');
    await expect(prefilled.getByText('Attachment: image/png, 1 KB')).toBeVisible();

    // The installed app's shortcut opens the landing with its id: an empty task to fill in.
    expect(manifest.shortcuts).toEqual([{ name: 'New task', url: '/?os-shortcut=task.new' }]);
    await page.goto(`${host.origin}/?os-shortcut=task.new`);
    await expect(prefilled.getByText('Opened from a shortcut')).toBeVisible();
    await expect(prefilled.getByLabel('Title')).toHaveValue('');
    expect(new URL(page.url()).search).toBe('');
  } finally {
    await host?.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
