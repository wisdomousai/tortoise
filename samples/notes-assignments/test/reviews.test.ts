import { afterEach, expect, test } from 'bun:test';
import { olga, refused, startNotesAssignments, vera } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a member reports on a review sent to them, and an editor accepts it into the note', async () => {
  const sample = await startNotesAssignments();
  close = sample.close;
  const { run, read } = sample;
  const pumps = await run('note.add', {
    title: 'Pumps',
    text: 'Check the seals on pumps 3 and 4 before the shift starts.',
  });
  const valves = await run('note.add', { title: '', text: 'Replace two.' });

  // Planning is for editors, and the scope must name notes that exist.
  const week3 = { title: 'Week 3', scope: { notes: [pumps.id, valves.id] } };
  expect(await refused(run('assignment.review.create', week3, vera))).toBe('FORBIDDEN');
  expect(
    await refused(run('assignment.review.create', { ...week3, scope: { notes: ['gone'] } })),
  ).toBe('INVALID_INPUT');
  const sent = await run('assignment.review.create', {
    ...week3,
    assignee: { type: 'person', id: 'vera' },
  });
  expect(sent).toMatchObject({ status: 'sent', stage: 'sent' });

  // Vera sees the notes as they were when it was sent; a non-member sees nothing.
  expect(await read('assignment.feed', {}, vera)).toMatchObject({
    items: [
      {
        id: sent.id,
        kind: 'review',
        brief: {
          notes: [
            { id: pumps.id, title: 'Pumps' },
            { id: valves.id, title: '', text: 'Replace two.' },
          ],
        },
      },
    ],
  });
  expect(await refused(read('assignment.feed', {}, olga))).toBe('FORBIDDEN');

  const report = (id: string, subject: string, verdict: string, comment: string) =>
    run(
      'assignment.review.report',
      { id, assignmentId: sent.id, subject, body: { verdict, comment } },
      vera,
    );
  await report('r1', valves.id as string, 'revise', 'Give it a title.');
  await report('r2', pumps.id as string, 'keep', 'Reads complete.');
  // A report is about a note in the review; another one is refused.
  expect(await refused(report('r3', 'elsewhere', 'keep', 'Not in scope.'))).toBe('INVALID_INPUT');
  await run('assignment.complete', { id: sent.id }, vera);
  // A report that arrives after the done mark, such as a retried delivery, is still taken.
  await report('r4', pumps.id as string, 'keep', 'Late, but recorded.');

  // Accepting needs an editor, and writes the comment into the note as that editor.
  expect(await refused(run('assignment.review.accept', { id: 'r1' }, vera))).toBe('FORBIDDEN');
  await run('assignment.review.accept', { id: 'r1', comment: 'Title it after the valve.' });
  expect(await read('note.get', { id: valves.id })).toMatchObject({
    text: 'Replace two.\n\nReview (revise): Title it after the valve.',
  });
  await run('assignment.report.discard', { id: 'r2', reason: 'Nothing to add.' });
  await run('assignment.close', { id: sent.id });
  expect(await read('assignment.get', { id: sent.id })).toMatchObject({ stage: 'closed' });
  expect(await refused(report('r5', pumps.id as string, 'keep', 'Too late.'))).toBe('CONFLICT');
  expect(await read('assignment.feed', {}, vera)).toMatchObject({ items: [], more: false });
});

test('the assignee list names the members and the reviewer agent', async () => {
  const sample = await startNotesAssignments();
  close = sample.close;
  expect(await sample.read('review.assignee.list', {}, vera)).toEqual({
    items: [
      { type: 'person', id: 'owner', label: 'owner (editor)' },
      { type: 'person', id: 'vera', label: 'vera (viewer)' },
      { type: 'agent', id: 'note.reviewer', label: 'Note reviewer' },
    ],
  });
  expect(await refused(sample.read('review.assignee.list', {}, olga))).toBe('FORBIDDEN');
});
