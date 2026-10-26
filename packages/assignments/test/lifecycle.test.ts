import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@agent-native/runtime';
import { createFixture, outsider, planner, worker } from './application';

type Fixture = ReturnType<typeof createFixture>;
const run = async (fixture: Fixture, context: ExecutionContext, operation: string, input: object) =>
  (await fixture.application.invokeRaw({ operation, input }, context)).result as Record<
    string,
    unknown
  >;
const read = async (
  fixture: Fixture,
  context: ExecutionContext,
  operation: string,
  input: object,
) =>
  (await fixture.application.queryRaw({ operation, input }, context)).data as Record<
    string,
    unknown
  >;
const review = { title: 'Week 3', scope: { notes: ['n1', 'n2'] } };
const toWes = { type: 'person', id: 'wes' } as const;
const body = (comment: string) => ({ verdict: 'revise', comment });

describe('assignment lifecycle', () => {
  test('a planner sends a review, the assignee reports and finishes, the planner accepts and closes', async () => {
    const fixture = createFixture();
    const created = await run(fixture, planner, 'assignment.review.create', {
      ...review,
      assignee: toWes,
    });
    expect(created).toMatchObject({ id: 'a1', status: 'sent', stage: 'sent', reports: 0 });
    expect(created.brief).toEqual({
      notes: [
        { id: 'n1', title: 'Pumps', body: 'Check the seals.' },
        { id: 'n2', title: 'Valves', body: 'Replace two.' },
      ],
    });

    const feed = await read(fixture, worker, 'assignment.feed', {});
    expect(feed.items).toEqual([
      { id: 'a1', kind: 'review', title: 'Week 3', brief: created.brief, sentAt: 1_000 },
    ]);
    const again = await read(fixture, worker, 'assignment.feed', { cursor: feed.cursor });
    expect(again).toEqual({ items: [], cursor: feed.cursor, more: false });

    const reported = await run(fixture, worker, 'assignment.review.report', {
      id: 'r1',
      assignmentId: 'a1',
      subject: 'n1',
      body: body('The seal leaks.'),
    });
    expect(reported).toMatchObject({ review: 'new', reportedBy: 'wes', subject: 'n1' });
    expect(await read(fixture, planner, 'assignment.get', { id: 'a1' })).toMatchObject({
      stage: 'working',
      reports: 1,
      unreviewed: 1,
    });

    await run(fixture, worker, 'assignment.complete', { id: 'a1' });
    expect((await read(fixture, worker, 'assignment.feed', { cursor: feed.cursor })).items).toEqual(
      [],
    );
    expect(await read(fixture, planner, 'assignment.get', { id: 'a1' })).toMatchObject({
      stage: 'done',
    });

    const accepted = await run(fixture, planner, 'assignment.review.accept', { id: 'r1' });
    expect(accepted).toMatchObject({ review: 'accepted', reviewedBy: 'pat' });
    const updated = await run(fixture, planner, 'notes.note.update', { id: 'n1', comment: 'x' });
    expect(updated.comments).toEqual(['The seal leaks.', 'x']);
    expect(await read(fixture, planner, 'assignment.get', { id: 'a1' })).toMatchObject({
      stage: 'reviewed',
    });
    expect(await run(fixture, planner, 'assignment.close', { id: 'a1' })).toMatchObject({
      stage: 'closed',
    });
  });

  test('only the assignee reports, and an outsider sees nothing', async () => {
    const fixture = createFixture();
    await run(fixture, planner, 'assignment.review.create', { ...review, assignee: toWes });
    const report = { id: 'r1', assignmentId: 'a1', body: body('x') };
    await expect(run(fixture, planner, 'assignment.review.report', report)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(run(fixture, outsider, 'assignment.review.report', report)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(read(fixture, outsider, 'assignment.list', {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(read(fixture, worker, 'assignment.list', {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await read(fixture, worker, 'assignment.get', { id: 'a1' })).toMatchObject({ id: 'a1' });
  });

  test('a draft is sent later, to a lane its kind takes, with a brief from its scope', async () => {
    const fixture = createFixture();
    await expect(
      run(fixture, planner, 'assignment.review.create', { ...review, scope: { notes: ['n9'] } }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const draft = await run(fixture, planner, 'assignment.review.create', review);
    expect(draft).toMatchObject({ status: 'draft', stage: 'draft' });
    expect(draft.brief).toBeUndefined();
    expect((await read(fixture, worker, 'assignment.feed', {})).items).toEqual([]);
    await expect(
      run(fixture, planner, 'assignment.review.send', {
        id: draft.id,
        assignee: { type: 'device', id: 'tab-1' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'assignee' } });
    await expect(
      run(fixture, planner, 'assignment.field-survey.send', { id: draft.id, assignee: toWes }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await run(fixture, planner, 'assignment.review.send', { id: draft.id, assignee: toWes });
    expect((await read(fixture, worker, 'assignment.feed', {})).items).toHaveLength(1);
    await expect(
      run(fixture, planner, 'assignment.review.send', { id: draft.id, assignee: toWes }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      run(fixture, worker, 'assignment.review.report', {
        id: 'r1',
        assignmentId: draft.id,
        subject: 'n9',
        body: body('x'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'subject' } });
  });

  test('a failing accept hook writes nothing; placing the report first lets it through', async () => {
    const fixture = createFixture();
    await run(fixture, planner, 'assignment.review.create', { ...review, assignee: toWes });
    await run(fixture, worker, 'assignment.review.report', {
      id: 'r1',
      assignmentId: 'a1',
      body: body('Unplaced.'),
    });
    // Without a subject the hook calls the note command without a note, which refuses it.
    await expect(
      run(fixture, planner, 'assignment.review.accept', { id: 'r1' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await read(fixture, planner, 'assignment.report.get', { id: 'r1' })).toMatchObject({
      review: 'new',
    });
    await expect(
      run(fixture, planner, 'assignment.report.place', { id: 'r1', subject: 'n9' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'subject' } });
    await run(fixture, planner, 'assignment.report.place', { id: 'r1', subject: 'n2' });
    const accepted = await run(fixture, planner, 'assignment.review.accept', {
      id: 'r1',
      comment: 'Replace both.',
    });
    expect(accepted).toMatchObject({ review: 'accepted', accepted: { comment: 'Replace both.' } });
    const updated = await run(fixture, planner, 'notes.note.update', { id: 'n2', comment: 'x' });
    expect(updated.comments).toEqual(['Replace both.', 'x']);
  });

  test('a repeated report is harmless, a different one under its ID conflicts, and a closed assignment takes none', async () => {
    const fixture = createFixture();
    await run(fixture, planner, 'assignment.review.create', { ...review, assignee: toWes });
    const report = { id: 'r1', assignmentId: 'a1', subject: 'n1', body: body('Leaks.') };
    const first = await run(fixture, worker, 'assignment.review.report', report);
    expect(await run(fixture, worker, 'assignment.review.report', report)).toEqual(first);
    await expect(
      run(fixture, worker, 'assignment.review.report', { ...report, body: body('Other.') }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await run(fixture, worker, 'assignment.complete', { id: 'a1' });
    expect(await run(fixture, worker, 'assignment.complete', { id: 'a1' })).toMatchObject({
      status: 'done',
    });
    // A report delivered after the done mark is still taken.
    await run(fixture, worker, 'assignment.review.report', { ...report, id: 'r2' });
    await run(fixture, planner, 'assignment.close', { id: 'a1' });
    await expect(
      run(fixture, worker, 'assignment.review.report', { ...report, id: 'r3' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await run(fixture, worker, 'assignment.review.report', report)).toEqual(first);
  });

  test('withdrawing takes an assignment out of the feed; discarded reports are not accepted', async () => {
    const fixture = createFixture();
    await run(fixture, planner, 'assignment.review.create', { ...review, assignee: toWes });
    await run(fixture, worker, 'assignment.review.report', {
      id: 'r1',
      assignmentId: 'a1',
      subject: 'n1',
      body: body('Leaks.'),
    });
    const before = await read(fixture, worker, 'assignment.feed', {});
    await expect(run(fixture, worker, 'assignment.withdraw', { id: 'a1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await run(fixture, planner, 'assignment.withdraw', { id: 'a1', reason: 'Wrong week.' }),
    ).toMatchObject({ status: 'withdrawn', reason: 'Wrong week.' });
    const after = await read(fixture, worker, 'assignment.feed', { cursor: before.cursor });
    expect(after.items).toEqual([]);
    expect(after.cursor).not.toBe(before.cursor);
    await expect(
      run(fixture, worker, 'assignment.review.report', {
        id: 'r2',
        assignmentId: 'a1',
        body: body('Late.'),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await run(fixture, planner, 'assignment.report.discard', { id: 'r1', reason: 'Withdrawn.' });
    await expect(
      run(fixture, planner, 'assignment.review.accept', { id: 'r1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const listed = await read(fixture, planner, 'assignment.report.list', { review: 'discarded' });
    expect(listed).toMatchObject({ total: 1, items: [{ id: 'r1', reason: 'Withdrawn.' }] });
    expect(await read(fixture, planner, 'assignment.list', { stage: 'withdrawn' })).toMatchObject({
      total: 1,
    });
  });
});
