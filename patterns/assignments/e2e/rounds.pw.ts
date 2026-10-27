import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

type Host = Awaited<ReturnType<typeof startService>>;

/** Runs a command or query as the owner through the API. */
async function call(host: Host, kind: 'commands' | 'queries', operation: string, input: object) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const response = await fetch(`${host.origin}/api/v1/${kind}/${operation}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      kind === 'commands' ? { input, idempotencyKey: crypto.randomUUID() } : { input },
    ),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/** Submits a test request, so the test starts from requests. */
const submitRequest = (host: Host, input: Record<string, string>) =>
  call(host, 'commands', 'test-request.submit', input);

const gas = 'IEC 60567 dissolved gas analysis';

test('send a sampling round to yourself, report a sample per transformer, place and accept them into test requests and close it', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-rounds-'));
  const host = await startService('@agent-native/pattern-assignments', workspace);
  try {
    await submitRequest(host, {
      sample: 'OS-24-0301',
      transformer: 'TR-40517',
      description: 'Annual sample.',
      method: gas,
    });
    await submitRequest(host, {
      sample: 'OS-24-0302',
      transformer: 'TR-40522',
      description: 'Annual sample.',
    });
    await submitRequest(host, {
      sample: 'OS-24-0303',
      transformer: 'TR-31200',
      description: 'After a tap changer repair.',
    });
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Sampling rounds' })).toBeVisible();

    // The transformers are picked from the lab's or added by name, and the assignee from the
    // members.
    await page.getByRole('button', { name: 'New sampling round' }).click();
    const form = page.getByRole('form', { name: 'New Sampling round' });
    await form.getByLabel('Title').fill('Northfield, week 17');
    // The launch signs in the principal `owner`, a technician of the workspace.
    const assignee = form.getByLabel('Assignee');
    await expect(assignee.locator('option', { hasText: 'owner (technician)' })).toHaveCount(1);
    await assignee.selectOption({ label: 'owner (technician)' });
    const transformers = form.getByRole('group', { name: /Transformers/ });
    await transformers.getByLabel('Substation').fill('Northfield 110 kV');
    // Ticked transformers stay picked while the search changes.
    await transformers.getByLabel('Search transformers').fill('TR-405');
    await expect(transformers.getByLabel('TR-31200')).toBeHidden();
    await transformers.getByLabel('TR-40517').check();
    await transformers.getByLabel('Search transformers').fill('');
    await transformers.getByLabel('TR-40522').check();
    await transformers.getByLabel('Transformer to add').fill('TR-40530');
    await transformers.getByRole('button', { name: 'Add transformer' }).click();
    await expect(transformers).toContainText('3 of at most 20');
    await form.getByRole('button', { name: 'Create and send' }).click();
    const row = page.getByRole('listitem', { name: 'Northfield, week 17' });
    await expect(row.getByText('sent', { exact: true })).toBeVisible();
    await expect(row).toContainText('Northfield 110 kV · TR-40517, TR-40522, TR-40530');

    // The brief shows each transformer's last sample as sent, and the form moves to the next
    // transformer after a report.
    await page.getByRole('link', { name: 'My rounds' }).click();
    const item = page.getByRole('listitem', { name: 'Northfield, week 17' });
    const brief = item.getByRole('list', { name: 'Transformers to sample' });
    await expect(brief).toContainText(`Last sample OS-24-0301: ${gas}`);
    await expect(brief).toContainText('Last sample OS-24-0302: no method assigned');
    await expect(brief).toContainText('No sample in the lab yet');
    const sample = item.getByRole('form', { name: 'Sample for Northfield, week 17' });
    const transformer = sample.getByLabel('Transformer');
    await expect(transformer.locator('option:checked')).toHaveText('TR-40517');
    await sample.getByLabel('Sample number').fill('OS-24-0417');
    await sample.getByLabel('What to test').fill('Buchholz relay alarmed last week; gas analysis.');
    await sample.getByRole('button', { name: 'Report' }).click();
    await expect(item.getByRole('status')).toHaveText('Reported');
    await expect(transformer.locator('option:checked')).toHaveText('TR-40522');
    await sample.getByLabel('Sample number').fill('OS-24-0418');
    await sample.getByLabel('What to test').fill('Annual sample. Breather gel is pink.');
    await sample.getByRole('button', { name: 'Report' }).click();
    await expect(transformer.locator('option:checked')).toHaveText('TR-40530');
    await item.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Nothing assigned to you.')).toBeVisible();
    // A report without a transformer, as a peer's from an out-of-date brief would arrive.
    const listed = (await call(host, 'queries', 'assignment.list', {})) as {
      data: { items: { id: string }[] };
    };
    const assignmentId = listed.data.items[0]!.id;
    await call(host, 'commands', 'assignment.sampling.report', {
      id: 'water-bottle',
      assignmentId,
      body: { sample: 'OS-24-0419', description: 'Second bottle for water content.' },
    });

    // Each report names its transformer and reads as a sample; accepting submits a test request
    // with the method the technician assigns.
    await page.getByRole('link', { name: 'Sampling rounds', exact: true }).click();
    await expect(row.getByText('done', { exact: true })).toBeVisible();
    await expect(row.getByText('3 to review')).toBeVisible();
    const reports = page.getByRole('region', { name: 'Reports' });
    const buchholz = reports.getByRole('listitem').filter({ hasText: 'Buchholz' });
    await expect(buchholz.getByText('TR-40517', { exact: true })).toBeVisible();
    await expect(buchholz.getByText('OS-24-0417', { exact: true })).toBeVisible();
    await buchholz.getByLabel('Test method').fill(gas);
    await buchholz.getByRole('button', { name: 'Submit test request' }).click();
    await expect(buchholz.getByText('accepted', { exact: true })).toBeVisible();
    await expect(buchholz.getByText(`Test method: ${gas}`)).toBeVisible();
    const breather = reports.getByRole('listitem').filter({ hasText: 'Breather gel' });
    await breather.getByRole('button', { name: 'Discard' }).click();
    await expect(breather.getByText('discarded', { exact: true })).toBeVisible();
    // The unplaced report is placed on a transformer of its round before it is accepted.
    const water = reports.getByRole('listitem').filter({ hasText: 'water content' });
    await expect(water.getByRole('button', { name: 'Submit test request' })).toBeDisabled();
    await water.getByLabel('Transformer to place it on').selectOption('TR-40522');
    await water.getByRole('button', { name: 'Place' }).click();
    await expect(water.getByText('TR-40522', { exact: true })).toBeVisible();
    await water.getByLabel('Test method').fill('IEC 60814 water content');
    await water.getByRole('button', { name: 'Submit test request' }).click();
    await expect(water.getByText('accepted', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Close' }).click();
    await expect(row.getByText('closed', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Test requests', exact: true }).click();
    await expect(page.getByRole('main')).toContainText('OS-24-0417');
    await expect(page.getByRole('main')).toContainText('OS-24-0419');
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
