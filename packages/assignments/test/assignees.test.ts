import { describe, expect, test } from 'bun:test';
import { deterministicHarness } from '@agent-native/agents';
import type { BlobRef } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import {
  assertAgentScenarios,
  runAgentScenarios,
  type AgentScenario,
} from '@agent-native/testing/agent-scenarios';
import { offerEventType } from '../src';
import { assignmentTargetPort, type TargetWork } from '../src/server';
import { createFixture, INTEGRATION, planner, worker, WORKSPACE } from './application';

type Fixture = ReturnType<typeof createFixture>;
type Row = Record<string, unknown>;
const toChecker = { type: 'target', id: 'checker' } as const;

/** The fixture with the checker target connected through the feature's own `connect`. */
function withChecker(work: Parameters<typeof assignmentTargetPort>[0]['work']) {
  const fixture = createFixture({
    targets: {
      checker: {
        principalId: INTEGRATION,
        port: (context) =>
          assignmentTargetPort({ target: 'checker', readBlob: context.readBlob, work }),
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
  const [checker] = connections.integrations!;
  const run = async (operation: string, input: object, as: ExecutionContext = planner) =>
    (await fixture.application.invokeRaw({ operation, input }, as)).result as Row;
  const read = async (operation: string, input: object, as: ExecutionContext = planner) =>
    (await fixture.application.queryRaw({ operation, input }, as)).data as Row;
  return { fixture, checker: checker!, run, read };
}

const attach = (fixture: Fixture, text: string): Promise<BlobRef> =>
  fixture.application.putBlob(new TextEncoder().encode(text), 'text/plain', planner);

describe('assignment target', () => {
  test('the checker reads the brief and its attachment, and its reports come back for review', async () => {
    const offers: Row[] = [];
    const { fixture, checker, run, read } = withChecker(async (offer, tools) => {
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

    expect(await checker.dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    expect(offers).toEqual([
      {
        assignmentId: 'a1',
        kind: 'review',
        title: 'Week 3',
        brief: (sent as { brief: Row }).brief,
      },
    ]);
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({ delivery: 'accepted' });

    await checker.inbound.runOnce();
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

  test('a refused offer completes as rejected and the planner sees why', async () => {
    const refused: TargetWork = { refused: { code: 'TOO_LONG', message: 'Over 10 notes.' } };
    const { checker, run, read } = withChecker(async () => refused);
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    expect(await checker.dispatcher.runOnce()).toMatchObject({ rejected: 1 });
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({
      status: 'sent',
      delivery: 'rejected',
      rejection: refused.refused,
    });
    expect(await read('assignment.checker.status', {})).toEqual({ waiting: 0, refused: 1 });
    expect(await run('assignment.withdraw', { id: 'a1' })).toMatchObject({ status: 'withdrawn' });
  });

  test('a result for a withdrawn assignment is dropped, and only the integration principal syncs', async () => {
    const { checker, run, read } = withChecker(async () => [
      { subject: 'n1', body: { verdict: 'keep', comment: 'Fine.' } },
    ]);
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    await checker.dispatcher.runOnce();
    await run('assignment.withdraw', { id: 'a1' });
    await checker.inbound.runOnce();
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
    const { checker, run } = withChecker(async (offer) => {
      offers.push(offer);
      return [];
    });
    await run('assignment.review.create', {
      title: 'Week 3',
      scope: { notes: ['n1'] },
      assignee: toChecker,
    });
    await run('assignment.withdraw', { id: 'a1' });
    await checker.dispatcher.runOnce();
    expect(offers).toEqual([]);
  });
});

describe('agent assignee', () => {
  const verdict = { verdict: 'revise', comment: 'Name the seal type.' };
  // Each run is scoped to the assignment, as a trigger on the offer event scopes it.
  const scenarios: AgentScenario[] = [
    {
      name: 'a run of another agent is refused, even with the assignment in its scope',
      agent: 'notes.other',
      task: 'Review assignment a1.',
      issuer: planner,
      resources: ['assignment:a1'],
      script: {
        commands: [
          {
            operation: 'assignment.review.report',
            input: { id: 'r0', assignmentId: 'a1', subject: 'n1', body: verdict },
          },
        ],
      },
      expect: {
        commits: [],
        refused: [{ operation: 'assignment.review.report', code: 'FORBIDDEN' }],
      },
    },
    {
      name: 'the assigned agent reads its assignment, reports and completes it',
      agent: 'notes.reviewer',
      task: 'Review assignment a1.',
      issuer: planner,
      resources: ['assignment:a1'],
      script: {
        commands: [
          { operation: 'assignment.get', input: { id: 'a1' } },
          {
            operation: 'assignment.review.report',
            input: { id: 'r1', assignmentId: 'a1', subject: 'n1', body: verdict },
          },
          { operation: 'assignment.complete', input: { id: 'a1' } },
        ],
      },
      expect: {
        commits: [
          { operation: 'assignment.review.report', input: { id: 'r1' } },
          { operation: 'assignment.complete', input: { id: 'a1' } },
        ],
        outcome: 'succeeded',
      },
    },
  ];

  test('an assignment sent to an agent is taken by a run of that agent only', async () => {
    const { application } = createFixture();
    await application.invokeRaw(
      {
        operation: 'assignment.review.create',
        input: {
          title: 'Week 3',
          scope: { notes: ['n1'] },
          assignee: { type: 'agent', id: 'notes.reviewer' },
        },
      },
      planner,
    );
    const { events } = await application.events(0, planner);
    expect(events.map((event) => [event.resource, event.type])).toEqual([
      ['assignment:a1', offerEventType('notes.reviewer')],
    ]);

    assertAgentScenarios(
      await runAgentScenarios(scenarios, { application, harness: deterministicHarness }),
    );
    const read = async (operation: string, input: object) =>
      (await application.queryRaw({ operation, input }, planner)).data;
    expect(await read('assignment.get', { id: 'a1' })).toMatchObject({
      status: 'done',
      reports: 1,
    });
    const [report] = ((await read('assignment.report.list', {})) as { items: object[] }).items;
    expect(report).toMatchObject({ id: 'r1', reportedBy: 'pat', review: 'new' });
    expect((report as { runId?: string }).runId).toStartWith('scenario-');
    await application.invokeRaw(
      { operation: 'assignment.review.accept', input: { id: 'r1' } },
      planner,
    );
  });
});
