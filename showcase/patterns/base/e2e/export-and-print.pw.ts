import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

test('Export CSV downloads every test request the filters match, and Print shows the request alone', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-export-'));
  const host = await startService('@tortoise/pattern-base', workspace);
  try {
    const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
    // More than one page of the list query, which takes at most 100 rows.
    const ids: string[] = [];
    for (let index = 1; index <= 120; index += 1) {
      const response = await fetch(`${host.origin}/api/v1/commands/test-request.submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: {
            sample: `OS-24-${String(index).padStart(4, '0')}`,
            transformer: 'TR-40417',
            description: 'Routine oil sample.',
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      expect(response.ok).toBe(true);
      ids.push(((await response.json()) as { result: { id: string } }).result.id);
    }

    await page.goto(host.launchUrl);
    await page.goto(`${host.origin}/#/requests`);
    await expect(page.getByRole('heading', { name: 'Test requests', level: 1 })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('test-requests.csv');
    const lines = (await readFile(await file.path(), 'utf8')).replace(/^﻿/, '').trimEnd();
    const rows = lines.split('\r\n');
    expect(rows[0]).toBe('Sample,Transformer,Test method,Submitted by');
    expect(rows).toHaveLength(121);
    expect(rows.filter((row) => row.startsWith('OS-24-0120,TR-40417,'))).toHaveLength(1);

    await page.goto(`${host.origin}/#/requests/${ids[0]}`);
    await expect(page.getByRole('heading', { name: 'Test request OS-24-0001' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled();
    await page.emulateMedia({ media: 'print' });
    // The printed page has the heading and the fields, without the shell or the edit form.
    await expect(page.getByRole('heading', { name: 'Test request OS-24-0001' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'TR-40417' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Edit' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
