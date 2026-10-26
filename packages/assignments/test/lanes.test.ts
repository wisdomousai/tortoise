import { describe, expect, test } from 'bun:test';
import type { BlobRef } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import { assignmentTargetPort, type TargetWork } from '../src/server';
import { createFixture, INTEGRATION, planner, worker, WORKSPACE } from './application';

type Fixture = ReturnType<typeof createFixture>;
type Row = Record<string, unknown>;
const toChecker = { type: 'target', id: 'checker' } as const;

/** The fixture with the checker lane connected through the feature's own `connect`. */
function withChecker(work: Parameters<typeof assignmentTargetPort>[0]['work']) {
  const fixture = createFixture({
    targets: {
      checker: {
        principalId: INTEGRATION,
        port: (context) =>
          assignmentTargetPort({ lane: 'checker', readBlob: context.readBlob, work }),
      },
    },
  });
  const connections = fixture.definition.connect!({
    application: fixture.application,
    workspaceId: WORKSPACE,
    network: {} as never,
    processes: {} as never,
    folders: {} as never,
    services: {},
  });
  const [lane] = connections.integrations!;
  const run = async (operation: string, input: object, as: ExecutionContext = planner) =>
    (await fixture.application.invokeRaw({ operation, input }, as)).result as Row;
  const read = async (operation: string, input: object, as: ExecutionContext = planner) =>
    (await fixture.application.queryRaw({ operation, input }, as)).data as Row;
  return { fixture, lane: lane!, run, read };
}

const attach = (fixture: Fixture, text: string): Promise<BlobRef> =>
  fixture.application.putBlob(new TextEncoder().encode(text), 'text/plain', planner);

describe('target lane', () => {
  test('the checker reads the brief and its attachment, and its reports come back for review', async () => {
    const offers: Row[] = [];
    const { fixture, lane, run, read } = withChecker(async (offer, tools) => {
      offers.push(offer as Row);
      const [ref] = offer.brief.attachments as BlobRef[];
      const text = new TextDecoder().decode((await tools.readBlob(ref!.digest))!.data);
      return [
        { subject: 'n1', body: { verdict: 'revise', comment: text } },
        { subject: 'n9', body: { verdict: 'keep', comment: 'Not in scope.' } },
        { body: { verdict: 'unsure', comment: 'Refused by the report schema.' } },
      ];
    });
    const ref = await attach(fixture, 'The seal leaks at 4 bar.');
    const sent = await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1', 'n2'], attachments: [ref] },
      assignee: toChecker,
    });
    expect(sent).toMatchObject({ status: 'sent', delivery: 'pending' });
    expect(await read('assignment.checker.status', {})).toEqual({ waiting: 1, refused: 0 });

    expect(await lane.dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    expect(offers).toEqual([
      {
        assignmentId: 'a1',
        kind: 'review',
        title: 'Week 3',
        brief: (sent as { brief: Row }).brief,
      },
    ]);
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({ delivery: 'accepted' });

    await lane.inbound.runOnce();
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({
      status: 'done',
      doneBy: INTEGRATION,
      reports: 2,
      unreviewed: 2,
    });
    const reports = (await read('assignment.report.list', { assignmentId: 'a1' })).items as Row[];
    expect(reports.map((report) => [report.subject, report.reportedBy])).toEqual([
      ['n1', INTEGRATION],
      [undefined, INTEGRATION],
    ]);
    await run('assignment.review.accept', { id: reports[0]!.id });
    const note = await run('notes.note.update', { id: 'n1', comment: 'x' });
    expect(note.comments).toEqual(['The seal leaks at 4 bar.', 'x']);
    expect(await read('assignment.checker.status', {})).toMatchObject({
      waiting: 0,
      refused: 0,
      watermark: '1',
    });
  });

  test('a refused offer settles as rejected and the planner sees why', async () => {
    const refused: TargetWork = { refused: { code: 'TOO_LONG', message: 'Over 10 notes.' } };
    const { lane, run, read } = withChecker(async () => refused);
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    expect(await lane.dispatcher.runOnce()).toMatchObject({ rejected: 1 });
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({
      status: 'sent',
      delivery: 'rejected',
      rejection: refused.refused,
    });
    expect(await read('assignment.checker.status', {})).toEqual({ waiting: 0, refused: 1 });
    expect(await run('assignment.withdraw', { id: 'a1' })).toMatchObject({ status: 'withdrawn' });
  });

  test('an answer for a withdrawn assignment is dropped, and only the integration principal syncs', async () => {
    const { lane, run, read } = withChecker(async () => [
      { subject: 'n1', body: { verdict: 'keep', comment: 'Fine.' } },
    ]);
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    await lane.dispatcher.runOnce();
    await run('assignment.withdraw', { id: 'a1' });
    await lane.inbound.runOnce();
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({
      status: 'withdrawn',
      reports: 0,
    });
    for (const as of [planner, worker])
      await expect(
        run('assignment.checker.sync', { to: '9', items: [] }, as),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a withdrawn offer the target has not taken is cancelled in the outbox', async () => {
    const offers: unknown[] = [];
    const { lane, run } = withChecker(async (offer) => {
      offers.push(offer);
      return [];
    });
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    await run('assignment.withdraw', { id: 'a1' });
    await lane.dispatcher.runOnce();
    expect(offers).toEqual([]);
  });
});
