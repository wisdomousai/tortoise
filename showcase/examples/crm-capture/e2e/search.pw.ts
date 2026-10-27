import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

test('search as you type, adopt, and log an activity that reaches the CRM', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-crm-'));
  // A slow CRM makes the in-between state observable: the previous result stays on screen.
  const host = await startService('@agent-native/crm-capture', workspace, {
    DEMO_CRM_LATENCY_MS: '400',
  });
  try {
    await page.goto(host.launchUrl);
    const search = page.getByLabel('Search the CRM');
    const accounts = page.getByRole('list', { name: 'CRM accounts' });
    // Before typing, the CRM answers with its first page of what Ann may see; more is one click.
    await expect(accounts.getByRole('listitem')).toHaveCount(5);
    const more = page.getByRole('button', { name: 'Show more from the CRM' });
    await more.click();
    await expect(accounts.getByRole('listitem')).toHaveCount(7);
    await expect(more).toBeHidden();

    await search.fill('acme');
    await expect(accounts.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText(/Live from the CRM at .* with your CRM access/)).toBeVisible();

    // Narrowing the search keeps the last answer visible (dimmed) instead of an empty list.
    await search.fill('acme rob');
    await expect(page.getByText('Searching the CRM…')).toBeVisible();
    await expect(accounts.getByRole('listitem')).toHaveCount(2);
    await expect(accounts.getByRole('listitem')).toHaveCount(1);
    // Ben's private account is not shared with this CRM login, so it never appears.
    await search.fill('alpine');
    await expect(page.getByText('No matches you can see in the CRM.')).toBeVisible();

    // Adopting asks the CRM; the feed then delivers the account, live, without a new search.
    await search.fill('acme rob');
    await page.getByRole('button', { name: 'Adopt Acme Robotics' }).click();
    await expect(accounts.getByText('Adopting…')).toBeVisible();
    await expect(accounts.getByText('Adopted')).toBeVisible({ timeout: 10_000 });

    // A contact leads to its account.
    await page.getByRole('tab', { name: 'contacts' }).click();
    await search.fill('fischer');
    const contacts = page.getByRole('list', { name: 'CRM contacts' });
    await expect(contacts.getByText('Lena Fischer · Fleet Director')).toBeVisible();
    await expect(contacts.getByRole('button', { name: 'Adopt Acme Logistics' })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Accounts' })
      .click();
    await page.getByRole('link', { name: 'Acme Robotics' }).click();
    await page.getByLabel('What happened').fill('Discussed the spring order');
    await page.getByRole('button', { name: 'Log activity' }).click();
    const activities = page.getByRole('region', { name: 'Activities' });
    await expect(activities.getByText('Discussed the spring order')).toBeVisible();
    await expect(activities.getByText(/In CRM 00T0001/)).toBeVisible({ timeout: 10_000 });
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('an unreachable CRM shows a status and keeps local work usable', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-crm-'));
  const host = await startService('@agent-native/crm-capture', workspace, {
    DEMO_CRM_UNAVAILABLE: '1',
  });
  try {
    await page.goto(host.launchUrl);
    await page.getByLabel('Search the CRM').fill('acme');
    await expect(page.getByRole('alert')).toContainText('CRM unavailable');
    await expect(page.getByRole('alert')).toContainText('The CRM is not reachable');
    await expect(page.getByText('No adopted account matches.')).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
