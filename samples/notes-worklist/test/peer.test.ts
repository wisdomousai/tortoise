import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from '@agent-native/runtime';
import { startPeerPair } from '@agent-native/peer-link/testing';
import { createNotesAssignmentsApplication } from '@agent-native/sample-notes-assignments/application';
import { createNotesWorklistApplication } from '../application';

/** notes-assignments sends a review to notes-worklist, two hosts on loopback. */

type Row = Record<string, unknown>;

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function pair() {
  const directory = await mkdtemp(join(tmpdir(), 'notes-worklist-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const port = await freePort();
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      destinations: {
        'reviews-peer': { url: `http://127.0.0.1:${port}`, addresses: ['127.0.0.1/32'] },
      },
    }),
  );
  let next = 0;
  const started = await startPeerPair({
    callee: createNotesAssignmentsApplication(),
    caller: () => createNotesWorklistApplication({ services: { newId: () => `w${++next}` } }),
    target: 'reviews',
    destination: 'reviews-peer',
    fetch,
    hosts: { callee: { port }, caller: { settings: { 'site-policy': policy } } },
  });
  cleanup.push(() => started.close());
  const { callee, caller, owner, peerId } = started;
  let keys = 0;
  const on = (host: typeof callee) => ({
    run: async (operation: string, input: object, as: ExecutionContext = owner) =>
      (await host.application.invokeRaw({ operation, input, idempotencyKey: `k${++keys}` }, as))
        .result as Row,
    read: async (operation: string, input: object = {}, as: ExecutionContext = owner) =>
      (await host.application.queryRaw({ operation, input }, as)).data as Row,
  });
  const lane = caller.integrations.target('reviews');
  return { issuer: on(callee), worklist: on(caller), lane, peerId };
}

test('a review sent to the peer arrives in its worklist, and its reports and done mark come back', async () => {
  const { issuer, worklist, lane, peerId } = await pair();
  const valves = await issuer.run('note.add', { title: '', text: 'Replace two.' });
  const sent = await issuer.run('assignment.review.create', {
    title: 'Week 3',
    scope: { notes: [valves.id] },
    assignee: { type: 'peer', id: peerId },
  });

  await lane.inbound.runOnce();
  const { items } = (await worklist.read('worklist.assignment.list')) as { items: Row[] };
  expect(items).toMatchObject([
    {
      id: sent.id,
      kind: 'review',
      open: true,
      brief: { notes: [{ id: valves.id, title: '', text: 'Replace two.' }] },
    },
  ]);

  await worklist.run('worklist.review.report', {
    assignmentId: sent.id,
    subject: valves.id,
    body: { verdict: 'revise', comment: 'Give it a title.' },
  });
  await worklist.run('worklist.assignment.complete', { id: sent.id });
  // Either may arrive first: notes-assignments still takes a report after the done mark.
  await lane.dispatcher.runOnce();

  expect(await issuer.read('assignment.get', { id: sent.id })).toMatchObject({
    status: 'done',
    doneBy: `peer:${peerId}`,
    reports: 1,
  });
  const reports = (await issuer.read('assignment.report.list', { assignmentId: sent.id }))
    .items as Row[];
  expect(reports).toMatchObject([
    { id: 'w1', subject: valves.id, reportedBy: `peer:${peerId}`, review: 'new' },
  ]);
  expect(await worklist.read('worklist.reviews.status')).toMatchObject({
    pending: 0,
    accepted: 2,
    rejected: 0,
  });
  expect(await worklist.read('worklist.report.list')).toMatchObject({
    items: [{ id: 'w1', sync: 'accepted' }],
  });

  // The issuer accepts the report into its note; the peer never could.
  await issuer.run('assignment.review.accept', { id: 'w1' });
  expect(await issuer.read('note.get', { id: valves.id })).toMatchObject({
    text: 'Replace two.\n\nReview (revise): Give it a title.',
  });
});

test('a report on a withdrawn review is refused, and the next sync closes it here', async () => {
  const { issuer, worklist, lane, peerId } = await pair();
  const pumps = await issuer.run('note.add', { title: 'Pumps', text: 'Check the seals.' });
  const sent = await issuer.run('assignment.review.create', {
    title: 'Week 3',
    scope: { notes: [pumps.id] },
    assignee: { type: 'peer', id: peerId },
  });
  await lane.inbound.runOnce();
  await issuer.run('assignment.withdraw', { id: sent.id, reason: 'Sent by mistake.' });

  await worklist.run('worklist.review.report', {
    assignmentId: sent.id,
    subject: pumps.id,
    body: { verdict: 'keep', comment: 'Fine.' },
  });
  await lane.dispatcher.runOnce();
  expect(await worklist.read('worklist.report.list')).toMatchObject({
    items: [{ sync: 'rejected', rejection: { code: 'CONFLICT' } }],
  });
  expect(await issuer.read('assignment.report.list')).toMatchObject({ items: [] });

  await lane.inbound.runOnce();
  expect(await worklist.read('worklist.assignment.get', { id: sent.id })).toMatchObject({
    open: false,
    done: false,
  });
});
