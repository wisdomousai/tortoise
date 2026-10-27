import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

type Host = Awaited<ReturnType<typeof startService>>;

async function addNote(host: Host, title: string, text: string) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const response = await fetch(`${host.origin}/api/v1/commands/note.add`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: { title, text }, idempotencyKey: crypto.randomUUID() }),
  });
  expect(response.ok).toBe(true);
}

test('connect the worklist, take a review from notes-assignments and send back a verdict', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-worklist-'));
  await mkdir(join(workspace, 'hub'));
  await mkdir(join(workspace, 'peer'));
  const hub = await startService('@agent-native/sample-notes-assignments', join(workspace, 'hub'));
  let worklist: Host | undefined;
  try {
    await addNote(hub, 'Handover', 'Restart the line after the shift change.');
    await addNote(hub, 'Suppliers', 'Call the valve supplier on Mondays.');
    // The site policy binds the worklist's destination to the hub this test started.
    const policy = join(workspace, 'site-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        audit: { mode: 'best-effort' },
        destinations: { 'reviews-peer': { url: hub.origin, addresses: ['127.0.0.1/32'] } },
      }),
    );
    worklist = await startService('@agent-native/sample-notes-worklist', join(workspace, 'peer'), {
      AGENT_NATIVE_SITE_POLICY: policy,
    });
    // Both applications sign in on 127.0.0.1, so each gets its own cookie jar.
    const issuer = await (await browser.newContext()).newPage();
    const peer = await (await browser.newContext()).newPage();
    await issuer.goto(hub.launchUrl);
    await peer.goto(worklist.launchUrl);

    await issuer.goto(`${hub.origin}/#/peers`);
    await issuer.getByRole('textbox', { name: 'Name' }).fill('Notes worklist');
    await issuer.getByRole('button', { name: 'Create code' }).click();
    await expect(issuer.locator('main')).toContainText(/[A-Z0-9]{5}-[A-Z0-9]{5}/);
    const code = (await issuer.locator('main').innerText()).match(/[A-Z0-9]{5}-[A-Z0-9]{5}/)![0];
    await peer.goto(`${worklist.origin}/#/peers`);
    await peer.getByRole('textbox', { name: 'Code from reviews' }).fill(code);
    await peer.getByRole('button', { name: 'Connect' }).click();
    await expect(peer.locator('main table')).toContainText('notes-assignments');

    await issuer.goto(`${hub.origin}/#/reviews`);
    await issuer.getByRole('button', { name: 'New note review' }).click();
    const form = issuer.getByRole('form', { name: 'New Note review' });
    await form.getByLabel('Title').fill('Peer review');
    const assignee = form.getByLabel('Assignee');
    const connected = assignee.locator('option', { hasText: 'notes-worklist' });
    await expect(connected).toHaveCount(1);
    await assignee.selectOption({ label: await connected.innerText() });
    await form.getByLabel('Handover').check();
    await form.getByLabel('Suppliers').check();
    await form.getByRole('button', { name: 'Create and send' }).click();

    // The review arrives at the next sync with its brief; the verdict names a note of it.
    await peer.goto(`${worklist.origin}/#/reviews`);
    const item = peer.getByRole('listitem', { name: 'Peer review' });
    await expect(item.getByRole('list', { name: 'Notes to review' })).toContainText(
      'Call the valve supplier on Mondays.',
      { timeout: 30_000 },
    );
    const verdict = item.getByRole('form', { name: 'Verdict on Peer review' });
    await verdict.getByLabel('Revise').check();
    await verdict.getByLabel('Comment').fill('Say which shift restarts the line.');
    await verdict.getByRole('button', { name: 'Report' }).click();
    await expect(item.getByRole('status')).toHaveText('Recorded');
    await item.getByRole('button', { name: 'Done' }).click();
    const recorded = peer.getByRole('region', { name: 'Reports here' }).getByRole('listitem');
    await expect(recorded.getByText('Handover', { exact: true })).toBeVisible();
    await expect(recorded.getByText('At notes-assignments')).toBeVisible({ timeout: 30_000 });

    await issuer.goto(`${hub.origin}/#/reviews`);
    const row = issuer.getByRole('listitem', { name: 'Peer review' });
    await expect(row.getByText('done', { exact: true })).toBeVisible({ timeout: 30_000 });
    const report = issuer
      .getByRole('region', { name: 'Reports' })
      .getByRole('listitem')
      .filter({ hasText: 'Say which shift' });
    await expect(report.getByRole('link', { name: 'Handover' })).toBeVisible();
    await report.getByRole('button', { name: 'Accept into the note' }).click();
    await expect(report.getByText('accepted', { exact: true })).toBeVisible();
  } finally {
    await worklist?.stop();
    await hub.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
