import { afterEach, expect, test } from 'bun:test';
import { createClient } from '@agent-native/client';
import type { OsDelivery } from '@agent-native/contracts';
import { LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { connectMobileShell, type MobileOsBindings } from '@agent-native/mobile';
import type { AndroidIntent } from '@agent-native/shell/intents';
import type { ShellNotification } from '@agent-native/shell/notifications';
import { findTagAction } from '../os';
import { captureSummary, tagScreen, workRequest } from '../ui-native/os-requests';
import { cleanUp, openPhone, startHub, type Rows } from './fixtures';

afterEach(cleanUp);

/** Wait until `check` passes; a dispatcher pass and its backoff take a little while. */
async function until(check: () => Promise<boolean> | boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(10);
  }
}

/**
 * The phone's OS, faked: intents other apps send and those the app starts, the share sheet and
 * notifications. An iOS device has no intent module.
 */
function device(platform: 'android' | 'ios' = 'android') {
  const shown: ShellNotification[] = [];
  const started: AndroidIntent[] = [];
  const shared: { text?: string; url?: string; title?: string }[] = [];
  const reports: string[] = [];
  let deliver: ((record: unknown) => void) | undefined;
  const bindings: MobileOsBindings = {
    platform,
    scheme: 'dev.agentnative.survey',
    initialUri: async () => null,
    subscribe: () => () => undefined,
    inspect: async () => undefined,
    read: async () => undefined,
    open: async () => undefined,
    share: async (content) => void shared.push(content),
    notify: async (notification) => void shown.push(notification),
    replies: () => () => undefined,
    report: (message) => void reports.push(message),
    ...(platform === 'android'
      ? {
          intents: (_declared: unknown, listener: (record: unknown) => void) => {
            deliver = listener;
            return () => (deliver = undefined);
          },
          startIntent: async (intent: AndroidIntent) => void started.push(intent),
        }
      : {}),
  };
  return {
    bindings,
    shown,
    started,
    shared,
    reports,
    send: (record: unknown) => deliver?.(record),
  };
}

/** A hub with =G1 and its two breakers, an assignment over them, and a paired phone. */
async function surveyed(platform: 'android' | 'ios' = 'android') {
  const survey = await startHub();
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const q1 = await survey.node(g1.id, '=G1-Q1', 'Generator circuit breaker');
  await survey.node(g1.id, '=G1-Q2', 'Station supply breaker');
  const assignment = await survey.command<{ id: string }>('assignment.create', {
    title: 'Nameplates of =G1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });
  const field = await openPhone(
    survey.hub.url,
    await survey.enrollment('Phone 1'),
    `phone-${platform}`,
    platform,
  );
  const phone = device(platform);
  const connection = connectMobileShell(field.phone, field.application, phone.bindings);
  return { survey, field, phone, connection, g1, q1, assignment };
}

test('an assignment the hub sends is announced once, and the notice settles', async () => {
  const { survey, field, phone, assignment, g1 } = await surveyed();
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });
  await field.sync();
  field.phone.foreground();
  await until(() => phone.shown.length === 1);
  expect(phone.shown[0]).toMatchObject({
    category: 'assignment-new',
    title: 'New assignment',
    body: 'Nameplates of =G1',
    buttons: [],
  });
  const notices = () =>
    field.phone.instance.application.pendingEffects(
      { workspaceId: LOCAL_WORKSPACE, principalId: 'integration' },
      { target: 'assignment-notices' },
    );
  await until(async () => (await notices()).length === 0);

  // The hub sends every assignment of the device again; only the new one is announced.
  const second = await survey.command<{ id: string }>('assignment.create', {
    title: 'Insulation check of =G1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });
  await survey.command('assignment.dispatch', { id: second.id, deviceId: field.deviceId });
  await field.sync();
  await until(() => phone.shown.length === 2);
  expect(phone.shown[1]).toMatchObject({ body: 'Insulation check of =G1' });
  await Bun.sleep(50);
  expect(phone.shown).toHaveLength(2);
});

test('an asset tag from another app opens its node as a scan does', async () => {
  const { survey, field, phone, connection, assignment, q1 } = await surveyed();
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });
  await field.sync();
  const delivered: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => delivered.push(delivery));

  phone.send({ action: findTagAction, extras: { tag: '=G1-Q1' } });
  await until(() => delivered.length === 1);
  expect(delivered[0]).toEqual({
    type: 'openResource',
    resource: 'tag:=G1-Q1',
    provenance: { kind: 'intent', handler: 'node.from-tag' },
  });
  // A tag with a space or an undeclared extra is refused before any screen sees it.
  phone.send({ action: findTagAction, extras: { tag: '=G1 -Q1' } });
  phone.send({ action: findTagAction, extras: { tag: '=G1-Q1', assignment: 'a-1' } });
  await until(() => phone.reports.length === 2);
  expect(delivered).toHaveLength(1);

  // The screen the frame opens for it: the capture of the one node, or the search of its tag.
  const session = { client: createClient(field.phone.transport) };
  expect(await tagScreen('=G1-Q1', session)).toEqual({
    to: '/capture',
    params: { assignmentId: assignment.id, nodeId: q1.id, codes: ['=G1-Q1'] },
  });
  expect(await tagScreen('=G1', session)).toEqual({
    to: '/assignment',
    params: { assignmentId: assignment.id, q: '=G1' },
  });
  expect(await tagScreen('=G9', session)).toEqual({ to: '/assignments' });
  // A returned assignment takes no captures, so its tags open nothing in it.
  await field.command('field.assignment.return', { id: assignment.id });
  expect(await tagScreen('=G1-Q1', session)).toEqual({ to: '/assignments' });
});

test('a node raises a work request in the maintenance app, and a capture is shared as text', async () => {
  const { survey, field, phone, connection, assignment, q1 } = await surveyed();
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });
  await field.sync();
  const [node] = (
    await field.query<Rows<{ designation: string; name: string }>>('field.node.list', {
      assignmentId: assignment.id,
      q: '=G1-Q1',
    })
  ).items;
  const perform = (action: string, params: Record<string, string>) =>
    connection.perform({ action, params });

  expect(await perform('node.work-request', workRequest(node!, ' Housing cracked '))).toEqual({
    status: 'performed',
    action: 'node.work-request',
  });
  // Only to the declared package, with only the declared extras.
  expect(phone.started).toEqual([
    {
      action: 'com.example.maintenance.action.CREATE_WORK_REQUEST',
      package: 'com.example.maintenance',
      extras: { designation: '=G1-Q1', name: 'Generator circuit breaker', note: 'Housing cracked' },
    },
  ]);
  expect(
    await perform('node.work-request', { ...workRequest(node!, ''), priority: 'high' }),
  ).toMatchObject({ status: 'refused', reason: 'invalid' });

  await field.command('field.capture.record', {
    id: 'cap-q1',
    assignmentId: assignment.id,
    nodeId: q1.id,
    kind: 'nameplate',
    photos: [await field.photo({ manufacturer: 'ABB' })],
    codes: ['=G1-Q1'],
    condition: 'poor',
    note: 'Housing cracked',
    takenAt: 1_000,
  });
  const [capture] = (await field.query<Rows>('field.capture.list')).items;
  expect(await perform('capture.share', { text: captureSummary(capture as never) })).toMatchObject({
    status: 'performed',
  });
  expect(phone.shared[0]!.text!.split('\n').slice(0, 3)).toEqual([
    'nameplate capture of =G1-Q1',
    'Condition: poor',
    'Housing cracked',
  ]);
  // The share action carries text only.
  expect(await perform('capture.share', { url: 'https://example.com/' })).toMatchObject({
    status: 'refused',
    reason: 'invalid',
  });
});

test('on iOS the work request is refused, and the rest works', async () => {
  const { survey, field, phone, connection, assignment } = await surveyed('ios');
  expect(
    await connection.perform({
      action: 'node.work-request',
      params: { designation: '=G1-Q1', name: 'Generator circuit breaker', note: '' },
    }),
  ).toMatchObject({ status: 'refused', reason: 'failed' });
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: field.deviceId });
  await field.sync();
  field.phone.foreground();
  await until(() => phone.shown.length === 1);
});
