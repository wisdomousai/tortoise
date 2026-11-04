import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

type Host = Awaited<ReturnType<typeof startService>>;

async function submitRequest(host: Host, input: Record<string, string>) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const response = await fetch(`${host.origin}/api/v1/commands/test-request.submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input, idempotencyKey: crypto.randomUUID() }),
  });
  expect(response.ok).toBe(true);
}

test('connect the field crew, take a sampling round from the oil lab and send back a sample', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-worklist-'));
  await mkdir(join(workspace, 'lab'));
  await mkdir(join(workspace, 'crew'));
  const lab = await startService('@tortoise/pattern-assignments', join(workspace, 'lab'));
  let crew: Host | undefined;
  try {
    await submitRequest(lab, {
      sample: 'OS-24-0301',
      transformer: 'TR-40517',
      description: 'Annual sample.',
      method: 'IEC 60567 dissolved gas analysis',
    });
    // The site policy binds the worklist's destination to the oil lab this test started.
    const policy = join(workspace, 'site-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        audit: { mode: 'best-effort' },
        destinations: { 'lab-peer': { url: lab.origin, addresses: ['127.0.0.1/32'] } },
      }),
    );
    crew = await startService('@tortoise/pattern-worklist', join(workspace, 'crew'), {
      AGENT_NATIVE_SITE_POLICY: policy,
    });
    // Both applications sign in on 127.0.0.1, so each gets its own cookie jar.
    const issuer = await (await browser.newContext()).newPage();
    const peer = await (await browser.newContext()).newPage();
    await issuer.goto(lab.launchUrl);
    await peer.goto(crew.launchUrl);

    await issuer.goto(`${lab.origin}/#/peers`);
    await issuer.getByRole('textbox', { name: 'Name' }).fill('Field crew');
    await issuer.getByRole('button', { name: 'Create code' }).click();
    await expect(issuer.locator('main')).toContainText(/[A-Z0-9]{5}-[A-Z0-9]{5}/);
    const code = (await issuer.locator('main').innerText()).match(/[A-Z0-9]{5}-[A-Z0-9]{5}/)![0];
    await peer.goto(`${crew.origin}/#/peers`);
    await peer.getByRole('textbox', { name: 'Code from lab' }).fill(code);
    await peer.getByRole('button', { name: 'Connect' }).click();
    await expect(peer.locator('main table')).toContainText('test-requests-assignments');

    await issuer.goto(`${lab.origin}/#/rounds`);
    await issuer.getByRole('button', { name: 'New sampling round' }).click();
    const form = issuer.getByRole('form', { name: 'New Sampling round' });
    await form.getByLabel('Title').fill('Northfield, week 17');
    const assignee = form.getByLabel('Assignee');
    const connected = assignee.locator('option', { hasText: 'test-requests-worklist' });
    await expect(connected).toHaveCount(1);
    await assignee.selectOption({ label: await connected.innerText() });
    await form.getByLabel('Substation').fill('Northfield 110 kV');
    await form.getByLabel('TR-40517').check();
    await form.getByRole('button', { name: 'Create and send' }).click();

    // The round arrives at the next sync with its brief; the sample names a transformer of it.
    await peer.goto(`${crew.origin}/#/rounds`);
    const item = peer.getByRole('listitem', { name: 'Northfield, week 17' });
    await expect(item.getByRole('list', { name: 'Transformers to sample' })).toContainText(
      'Last sample OS-24-0301',
      { timeout: 30_000 },
    );
    const sample = item.getByRole('form', { name: 'Sample for Northfield, week 17' });
    await sample.getByLabel('Sample number').fill('OS-24-0417');
    await sample.getByLabel('What to test').fill('Buchholz relay alarmed last week; gas analysis.');
    await sample.getByRole('button', { name: 'Report' }).click();
    await expect(item.getByRole('status')).toHaveText('Recorded');
    await item.getByRole('button', { name: 'Done' }).click();
    const recorded = peer.getByRole('region', { name: 'Reports here' }).getByRole('listitem');
    await expect(recorded.getByText('TR-40517', { exact: true })).toBeVisible();
    await expect(recorded.getByText('At the oil lab')).toBeVisible({ timeout: 30_000 });

    await issuer.goto(`${lab.origin}/#/rounds`);
    const row = issuer.getByRole('listitem', { name: 'Northfield, week 17' });
    await expect(row.getByText('done', { exact: true })).toBeVisible({ timeout: 30_000 });
    const report = issuer
      .getByRole('region', { name: 'Reports' })
      .getByRole('listitem')
      .filter({ hasText: 'Buchholz' });
    await expect(report.getByText('TR-40517', { exact: true })).toBeVisible();
    await report.getByLabel('Test method').fill('IEC 60567 dissolved gas analysis');
    await report.getByRole('button', { name: 'Submit test request' }).click();
    await expect(report.getByText('accepted', { exact: true })).toBeVisible();
  } finally {
    await crew?.stop();
    await lab.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
