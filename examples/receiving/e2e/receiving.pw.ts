import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeFileConsumer } from '@agent-native/connector-files/testing';
import { startService } from '../../../tests/e2e/service';

test('a short line is counted, classified and posted through the exchange folders', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'receiving-e2e-'));
  const folders = { asn: 'erp-asn', drop: 'erp-goods-receipts', receipts: 'erp-receipts' };
  const path = (name: keyof typeof folders) => join(directory, 'share', name);
  for (const name of Object.keys(folders) as (keyof typeof folders)[])
    await mkdir(path(name), { recursive: true });
  await writeFile(
    join(path('asn'), 'asn-1001.csv'),
    [
      'id,purchaseOrder,supplier,sku,description,expected',
      'ASN-1001-1,PO-4711,Acme Fasteners,M8-40,Hex bolt,500',
      'ASN-1001-2,PO-4711,Acme Fasteners,W8,Washer 8 mm,600',
    ].join('\n'),
  );
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      folders: {
        [folders.asn]: { path: path('asn') },
        [folders.drop]: { path: path('drop') },
        [folders.receipts]: { path: path('receipts') },
      },
    }),
  );
  const host = await startService('@agent-native/receiving', join(directory, 'workspace'), {
    AGENT_NATIVE_SITE_POLICY: policy,
  });
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Deliveries', level: 1 })).toBeVisible();
    // The notice is imported once it has been quiet for two seconds and the next sync runs.
    const row = page.getByRole('row').filter({ hasText: 'W8' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    await page.getByRole('textbox', { name: 'Counted', exact: true }).fill('540');
    await page.getByRole('button', { name: 'Record count' }).click();
    await expect(page.getByRole('definition').filter({ hasText: /^540$/ })).toBeVisible();

    await page.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('short');
    await page.getByRole('textbox', { name: /^Note/ }).fill('One carton missing');
    await page.getByRole('button', { name: 'Save reason' }).click();
    await expect(page.getByRole('definition').filter({ hasText: /^short$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Post goods receipt' }).click();
    await expect(page.getByRole('definition').filter({ hasText: /^posted$/ })).toBeVisible();

    // The test plays the ERP: it takes the goods receipt file and responds with a receipt.
    await expect
      .poll(async () => (await readdir(path('drop'))).length, { timeout: 10_000 })
      .toBe(1);
    const erp = new FakeFileConsumer({
      drop: path('drop'),
      receipts: path('receipts'),
      format: 'csv',
    });
    await erp.process();
    expect([...erp.records.values()].flat()).toEqual([
      {
        delivery: 'ASN-1001-2',
        purchaseOrder: 'PO-4711',
        sku: 'W8',
        counted: '540',
        reason: 'short',
        note: 'One carton missing',
      },
    ]);

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'ERP' })
      .click();
    await expect(page.getByRole('definition').filter({ hasText: /^1$/ }).first()).toBeVisible();
    const accepted = page
      .getByRole('term')
      .filter({ hasText: 'Accepted' })
      .locator('xpath=following-sibling::dd[1]');
    await expect(accepted).toHaveText('1', { timeout: 20_000 });
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a receipt the ERP left unreadable is held, and an editor records that it was booked', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'receiving-e2e-'));
  const folders = { asn: 'erp-asn', drop: 'erp-goods-receipts', receipts: 'erp-receipts' };
  const path = (name: keyof typeof folders) => join(directory, 'share', name);
  for (const name of Object.keys(folders) as (keyof typeof folders)[])
    await mkdir(path(name), { recursive: true });
  await writeFile(
    join(path('asn'), 'asn-1001.csv'),
    [
      'id,purchaseOrder,supplier,sku,description,expected',
      'ASN-1001-1,PO-4711,Acme Fasteners,M8-40,Hex bolt,500',
    ].join('\n'),
  );
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      folders: {
        [folders.asn]: { path: path('asn') },
        [folders.drop]: { path: path('drop') },
        [folders.receipts]: { path: path('receipts') },
      },
    }),
  );
  const host = await startService('@agent-native/receiving', join(directory, 'workspace'), {
    AGENT_NATIVE_SITE_POLICY: policy,
  });
  try {
    await page.goto(host.launchUrl);
    const row = page.getByRole('row').filter({ hasText: 'M8-40' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await page.getByRole('textbox', { name: 'Counted', exact: true }).fill('500');
    await page.getByRole('button', { name: 'Record count' }).click();
    await page.getByRole('button', { name: 'Post goods receipt' }).click();

    // The ERP takes the file and leaves a receipt nobody can read.
    await expect
      .poll(async () => (await readdir(path('drop'))).length, { timeout: 10_000 })
      .toBe(1);
    const [file] = await readdir(path('drop'));
    await rm(join(path('drop'), file!));
    await writeFile(join(path('receipts'), file!.replace(/\.csv$/, '.json')), '{ not json');

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Held receipts' })
      .click();
    const held = page.getByRole('listitem', { name: 'Goods receipt for ASN-1001-1' });
    await expect(held).toBeVisible({ timeout: 20_000 });
    await expect(held).toContainText('The receipt for this file could not be read');
    await held.getByRole('textbox', { name: 'Reference or reason' }).fill('DOC-77');
    await held.getByRole('button', { name: 'Applied', exact: true }).click();
    await expect(page.getByText('No held deliveries.')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'ERP' })
      .click();
    const accepted = page
      .getByRole('term')
      .filter({ hasText: 'Accepted' })
      .locator('xpath=following-sibling::dd[1]');
    await expect(accepted).toHaveText('1', { timeout: 10_000 });
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
