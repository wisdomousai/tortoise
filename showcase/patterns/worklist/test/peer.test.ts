import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from '@agent-native/runtime';
import { startPeerPair } from '@agent-native/peer-link/testing';
import { createTestRequestsAssignmentsApplication } from '@agent-native/pattern-assignments/application';
import { createTestRequestsWorklistApplication } from '../application';

/** The oil lab sends a sampling round to the field crew's worklist, two hosts on loopback. */

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
  const directory = await mkdtemp(join(tmpdir(), 'pattern-worklist-'));
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
        'lab-peer': { url: `http://127.0.0.1:${port}`, addresses: ['127.0.0.1/32'] },
      },
    }),
  );
  let next = 0;
  const started = await startPeerPair({
    callee: createTestRequestsAssignmentsApplication(),
    caller: () =>
      createTestRequestsWorklistApplication({ services: { newId: () => `w${++next}` } }),
    target: 'lab',
    destination: 'lab-peer',
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
  const labTarget = caller.integrations.target('lab');
  return { issuer: on(callee), worklist: on(caller), labTarget, peerId };
}

const round = { substation: 'Northfield 110 kV', transformers: ['TR-40517'] };

test('a round sent to the field crew arrives in its worklist, and its samples and done mark come back', async () => {
  const { issuer, worklist, labTarget, peerId } = await pair();
  await issuer.run('test-request.submit', {
    sample: 'OS-24-0301',
    transformer: 'TR-40517',
    description: 'Annual sample.',
    method: 'IEC 60567 dissolved gas analysis',
  });
  const sent = await issuer.run('assignment.sampling.create', {
    title: 'Northfield, week 17',
    scope: round,
    assignee: { type: 'peer', id: peerId },
  });

  await labTarget.inbound.runOnce();
  const { items } = (await worklist.read('worklist.assignment.list')) as { items: Row[] };
  expect(items).toMatchObject([
    {
      id: sent.id,
      kind: 'sampling',
      open: true,
      brief: {
        substation: 'Northfield 110 kV',
        transformers: [
          {
            transformer: 'TR-40517',
            lastSample: 'OS-24-0301',
            lastMethod: 'IEC 60567 dissolved gas analysis',
          },
        ],
      },
    },
  ]);

  await worklist.run('worklist.sampling.report', {
    assignmentId: sent.id,
    subject: 'TR-40517',
    body: { sample: 'OS-24-0417', description: 'Buchholz relay alarmed last week; gas analysis.' },
  });
  await worklist.run('worklist.assignment.complete', { id: sent.id });
  // Either may arrive first: the oil lab still takes a report after the done mark.
  await labTarget.dispatcher.runOnce();

  expect(await issuer.read('assignment.get', { id: sent.id })).toMatchObject({
    status: 'done',
    doneBy: `peer:${peerId}`,
    reports: 1,
  });
  const reports = (await issuer.read('assignment.report.list', { assignmentId: sent.id }))
    .items as Row[];
  expect(reports).toMatchObject([
    { id: 'w1', subject: 'TR-40517', reportedBy: `peer:${peerId}`, review: 'new' },
  ]);
  expect(await worklist.read('worklist.lab.status')).toMatchObject({
    pending: 0,
    accepted: 2,
    rejected: 0,
  });
  expect(await worklist.read('worklist.report.list')).toMatchObject({
    items: [{ id: 'w1', sync: 'accepted' }],
  });

  // The oil lab accepts the sample into a test request; the field crew never could.
  await issuer.run('assignment.sampling.accept', {
    id: 'w1',
    method: 'IEC 60567 dissolved gas analysis',
  });
  expect(await issuer.read('test-request.list', { search: 'OS-24-0417' })).toMatchObject({
    items: [
      {
        sample: 'OS-24-0417',
        transformer: 'TR-40517',
        description: 'Buchholz relay alarmed last week; gas analysis.',
        method: 'IEC 60567 dissolved gas analysis',
      },
    ],
  });
});

test('a sample on a withdrawn round is refused, and the next sync closes it here', async () => {
  const { issuer, worklist, labTarget, peerId } = await pair();
  const sent = await issuer.run('assignment.sampling.create', {
    title: 'Northfield, week 17',
    scope: round,
    assignee: { type: 'peer', id: peerId },
  });
  await labTarget.inbound.runOnce();
  await issuer.run('assignment.withdraw', { id: sent.id, reason: 'Outage moved to week 19.' });

  await worklist.run('worklist.sampling.report', {
    assignmentId: sent.id,
    subject: 'TR-40517',
    body: { sample: 'OS-24-0417', description: 'Drawn before the round was withdrawn.' },
  });
  await labTarget.dispatcher.runOnce();
  expect(await worklist.read('worklist.report.list')).toMatchObject({
    items: [{ sync: 'rejected', rejection: { code: 'CONFLICT' } }],
  });
  expect(await issuer.read('assignment.report.list')).toMatchObject({ items: [] });

  await labTarget.inbound.runOnce();
  expect(await worklist.read('worklist.assignment.get', { id: sent.id })).toMatchObject({
    open: false,
    done: false,
  });
});
