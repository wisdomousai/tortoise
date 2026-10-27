import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

type Host = Awaited<ReturnType<typeof startService>>;

/** Adds a note as the owner through the API, so the test starts from notes that exist. */
async function addNote(host: Host, title: string, text: string) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const response = await fetch(`${host.origin}/api/v1/commands/note.add`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input: { title, text }, idempotencyKey: crypto.randomUUID() }),
  });
  expect(response.ok).toBe(true);
}

test('send a review to yourself, report a verdict per note, accept one into its note and close it', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-reviews-'));
  const host = await startService('@agent-native/sample-notes-assignments', workspace);
  try {
    await addNote(host, 'Handover', 'Restart the line after the shift change.');
    await addNote(host, 'Suppliers', 'Call the valve supplier on Mondays.');
    await addNote(host, 'Canteen', 'Opens at seven.');
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible();

    // The scope is picked from the notes, and the assignee from the members and the agent.
    await page.getByRole('button', { name: 'New note review' }).click();
    const form = page.getByRole('form', { name: 'New Note review' });
    await form.getByLabel('Title').fill('Shift notes');
    // The launch signs in the principal `owner`, an editor of the workspace.
    const assignee = form.getByLabel('Assignee');
    await expect(assignee.locator('option', { hasText: 'owner (editor)' })).toHaveCount(1);
    await assignee.selectOption({ label: 'owner (editor)' });
    // Ticked notes stay picked while the search changes.
    const notes = form.getByRole('group', { name: /Notes to review/ });
    await notes.getByLabel('Search notes').fill('supplier');
    await expect(notes.getByLabel('Canteen')).toBeHidden();
    await notes.getByLabel('Suppliers').check();
    await notes.getByLabel('Search notes').fill('');
    await notes.getByLabel('Handover').check();
    await expect(notes).toContainText('2 of at most 20');
    await form.getByRole('button', { name: 'Create and send' }).click();
    const row = page.getByRole('listitem', { name: 'Shift notes' });
    await expect(row.getByText('sent', { exact: true })).toBeVisible();
    await expect(row.getByRole('list', { name: 'Notes' })).toHaveText(/Suppliers.*Handover/);

    // The brief shows the notes as sent, and the form moves to the next note after a report.
    await page.getByRole('link', { name: 'My reviews' }).click();
    const item = page.getByRole('listitem', { name: 'Shift notes' });
    await expect(item.getByRole('list', { name: 'Notes to review' })).toContainText(
      'Restart the line after the shift change.',
    );
    const verdict = item.getByRole('form', { name: 'Verdict on Shift notes' });
    const note = verdict.getByLabel('Note');
    await expect(note.locator('option:checked')).toHaveText('Suppliers');
    await verdict.getByLabel('Comment').fill('Still right.');
    await verdict.getByRole('button', { name: 'Report' }).click();
    await expect(item.getByRole('status')).toHaveText('Reported');
    await expect(note.locator('option:checked')).toHaveText('Handover');
    await verdict.getByLabel('Revise').check();
    await verdict.getByLabel('Comment').fill('Say which shift restarts the line.');
    await verdict.getByRole('button', { name: 'Report' }).click();
    await expect(note.locator('option:checked')).toHaveText('Suppliers');
    await item.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Nothing assigned to you.')).toBeVisible();

    // Each report names its note and reads as a verdict; accepting adds the edited comment.
    await page.getByRole('link', { name: 'Reviews', exact: true }).click();
    await expect(row.getByText('done', { exact: true })).toBeVisible();
    await expect(row.getByText('2 to review')).toBeVisible();
    const reports = page.getByRole('region', { name: 'Reports' });
    const revise = reports.getByRole('listitem').filter({ hasText: 'Say which shift' });
    await expect(revise.getByRole('link', { name: 'Handover' })).toBeVisible();
    await expect(revise.getByText('Revise', { exact: true })).toBeVisible();
    const comment = revise.getByLabel('Comment added to the note');
    await expect(comment).toHaveValue('Say which shift restarts the line.');
    await comment.fill('Name the shift that restarts the line.');
    await revise.getByRole('button', { name: 'Accept into the note' }).click();
    await expect(revise.getByText('accepted', { exact: true })).toBeVisible();
    await expect(
      revise.getByText('Added to the note instead: Name the shift that restarts the line.'),
    ).toBeVisible();
    const keep = reports.getByRole('listitem').filter({ hasText: 'Still right.' });
    await keep.getByRole('button', { name: 'Discard' }).click();
    await expect(keep.getByText('discarded', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Close' }).click();
    await expect(row.getByText('closed', { exact: true })).toBeVisible();

    await revise.getByRole('link', { name: 'Handover' }).click();
    await expect(
      page.getByText('Review (revise): Name the shift that restarts the line.', { exact: false }),
    ).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
