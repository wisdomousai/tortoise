import { afterEach, expect, test } from 'bun:test';
import { refused, startNotesAssignments, until, vera } from './fixtures';

type Row = Record<string, unknown>;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a review sent to the reviewer agent is taken by a trigger run, and an editor accepts its report', async () => {
  const sample = await startNotesAssignments();
  close = sample.close;
  const { run, read } = sample;
  const pumps = await run('note.add', {
    title: 'Pumps',
    text: 'Check the seals on pumps 3 and 4 before the shift starts.',
  });
  const valves = await run('note.add', { title: '', text: 'Replace two.' });

  // The trigger runs only once a person issues a standing grant for it.
  await run('automation.grant.issue', {
    trigger: 'review-sent-to-agent',
    expiresInMs: 60 * 60 * 1000,
  });
  await until(async () => {
    const { items } = (await read('automation.trigger.list')) as { items: { cursor?: number }[] };
    return items[0]?.cursor !== undefined;
  });

  const forVera = await run('assignment.review.create', {
    title: 'For Vera',
    scope: { notes: [pumps.id] },
    assignee: { type: 'person', id: 'vera' },
  });
  const sent = await run('assignment.review.create', {
    title: 'Week 3',
    scope: { notes: [pumps.id, valves.id] },
    assignee: { type: 'agent', id: 'note.reviewer' },
  });
  await until(async () => (await read('assignment.get', { id: sent.id })).status === 'done');

  // The run reported once per note as the grant's issuer, and marked the review done.
  const { items } = (await read('assignment.report.list', { assignmentId: sent.id })) as {
    items: Row[];
  };
  expect(
    items
      .map((report) => [report.id, report.subject, (report.body as Row).verdict, report.reportedBy])
      .sort(),
  ).toEqual(
    [
      [`${sent.id}-${pumps.id}`, pumps.id, 'keep', 'owner'],
      [`${sent.id}-${valves.id}`, valves.id, 'revise', 'owner'],
    ].sort(),
  );
  for (const report of items) expect(report.runId).toStartWith('auto:');
  // A review for a person starts no run.
  expect(await read('assignment.get', { id: forVera.id })).toMatchObject({
    status: 'sent',
    reports: 0,
  });

  // The run's work reaches the note only when an editor accepts it.
  const id = `${sent.id}-${valves.id}`;
  expect(await refused(run('assignment.review.accept', { id }, vera))).toBe('FORBIDDEN');
  await run('assignment.review.accept', { id });
  expect(await read('note.get', { id: valves.id })).toMatchObject({
    text: 'Replace two.\n\nReview (revise): Give the note a title.',
  });
});
