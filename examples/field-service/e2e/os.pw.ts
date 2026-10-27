import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

/** A call to the instance as the page's own session, as the frame makes it. */
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

test('a protocol-handler launch opens the task; files and shares prefill tasks the person adds; a reminder waits; a shortcut starts a task', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-os-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    host = await startService('@agent-native/field-service', workspace);
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
    await page.getByLabel('New work order').fill('Alpha');
    await page.getByRole('button', { name: 'Create work order', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    const beta = (await api(page, 'commands/work-order.create', {
      input: { name: 'Beta' },
      idempotencyKey: 'beta',
    })) as { result: { id: string } };
    const task = (await api(page, 'commands/task.create', {
      input: { workOrderId: beta.result.id, title: 'Linked task' },
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
      request: { kind: 'file', name: 'Inspection checklist.md', text: 'Check the flue.' },
    });
    const prefilled = page.getByRole('region', { name: 'Prefilled task' });
    await expect(prefilled.getByText('Opened from a file: Inspection checklist.md')).toBeVisible();
    await expect(prefilled.getByLabel('Title')).toHaveValue('Inspection checklist');
    await expect(prefilled.getByLabel('Description')).toHaveValue('Check the flue.');
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(prefilled).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Inspection checklist', exact: true }),
    ).toBeVisible();

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
      request: { kind: 'file', name: 'Nameplate.png', mediaType: 'image/png', blob },
    });
    await expect(prefilled.getByText('Opened from a file: Nameplate.png')).toBeVisible();
    await expect(prefilled.getByText('Attachment: image/png, 1 KB')).toBeVisible();
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(prefilled).toBeHidden();
    const attachment = page.getByRole('link', { name: 'Download the attachment of Nameplate' });
    const href = await attachment.getAttribute('href');
    const downloaded = await page.evaluate(async (href) => {
      const response = await fetch(href!);
      return [...new Uint8Array(await response.arrayBuffer())];
    }, href);
    expect(downloaded).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Another app shares to the installed app: the browser posts the share target form as a
    // top-level navigation from no site, and the launch page claims it as its own session.
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
      '<input name="title" value="Service manual"><input name="url" value="https://example.com/manual">',
    );
    await expect(prefilled.getByText('Shared from another app')).toBeVisible();
    await expect(prefilled.getByLabel('Description')).toHaveValue('https://example.com/manual');
    expect(new URL(page.url()).search).toBe('');
    await prefilled.getByLabel('Title').fill('Read the service manual');
    await prefilled.getByRole('button', { name: /^Add task to / }).click();
    await expect(
      page.getByRole('button', { name: 'Read the service manual', exact: true }),
    ).toBeVisible();

    // A web page shows no notifications: the reminder waits for the desktop or phone app.
    const spec = page.getByTestId('task-row').filter({ hasText: 'Read the service manual' });
    await spec.hover();
    await spec.getByRole('button', { name: 'Remind me about Read the service manual' }).click();
    await expect(spec.getByText('Reminder waiting for the desktop or phone app')).toBeVisible();

    await share('', {
      name: 'Valve photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(prefilled.getByText('Shared from another app')).toBeVisible();
    await expect(prefilled.getByLabel('Title')).toHaveValue('Valve photo.png');
    await expect(prefilled.getByText('Attachment: image/png, 1 KB')).toBeVisible();

    // The installed app's shortcut opens the launch page with its id: an empty task to fill in.
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

test('Open map opens the site search without an opener, and Send summary shares the open tasks', async ({
  page,
  context,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-os-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  // The map stays offline, and the Web Share API is recorded instead of opening a sheet.
  await context.route('https://www.openstreetmap.org/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Map</title>' }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      value: async (data: ShareData) => {
        (window as { shared?: ShareData[] }).shared = [
          ...((window as { shared?: ShareData[] }).shared ?? []),
          data,
        ];
      },
    });
  });
  try {
    host = await startService('@agent-native/field-service', workspace);
    await page.goto(host.launchUrl);
    await page.getByLabel('New work order').fill('Chiller C2 service');
    await page.getByLabel('Site address').fill('Hafenstrasse 12, Basel');
    await page.getByRole('button', { name: 'Create work order', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chiller C2 service' })).toBeVisible();
    await expect(page.getByText('Hafenstrasse 12, Basel')).toBeVisible();
    await page.getByLabel('New task title').fill('Check refrigerant');
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Check refrigerant', exact: true }),
    ).toBeVisible();

    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Open map' }).click();
    const map = await popup;
    await map.waitForLoadState();
    expect(map.url()).toBe('https://www.openstreetmap.org/search?query=Hafenstrasse+12%2C+Basel');
    expect(await map.evaluate(() => window.opener)).toBeNull();
    await map.close();

    await page.getByRole('button', { name: 'Send summary' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as { shared?: ShareData[] }).shared))
      .toEqual([
        {
          title: 'Chiller C2 service',
          text: 'Chiller C2 service\nSite: Hafenstrasse 12, Basel\nOpen tasks:\n- Check refrigerant',
        },
      ]);
  } finally {
    await host?.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
