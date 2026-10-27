import { expect, test } from 'bun:test';
import type { CommandReceipt, Invocation } from '@agent-native/runtime';
import { createDriverEventIngest } from '../src/connect';
import { defineDriverContract } from '../src/contracts';
import type { DriverService } from '../src/open';
import { createDriverSupervisor } from '../src/supervisor';
import { createFakeDriver } from '../src/testing';

const scale = defineDriverContract({
  id: 'scale',
  version: '1.0.0',
  title: 'Scale',
  process: { id: 'scale-driver', purpose: 'Reads the scale', availability: 'optional' },
  state: { weight: { type: 'number' } },
  actions: {},
  events: {
    'weight.taken': { kind: 'occurrence' },
    'tare.pressed': { kind: 'occurrence' },
  },
});

function harness(fail?: (invocation: Invocation) => boolean) {
  const fake = createFakeDriver({
    contract: scale,
    state: { weight: 0 },
    devices: [{ serial: 'S-1' }, { serial: 'S-2', firmware: '2.0' }],
  });
  const listeners = new Set<Parameters<DriverService['onEvent']>[1]>();
  const supervisor = createDriverSupervisor({
    contract: scale,
    start: fake.start,
    healthMs: 0,
    async onEvent(event, session) {
      for (const listener of listeners) await listener(event, session);
    },
  });
  const invocations: Invocation[] = [];
  const errors: unknown[] = [];
  const ingest = createDriverEventIngest({
    contract: scale,
    service: {
      supervisor: () => supervisor,
      onEvent: (_id, listener) => (listeners.add(listener), () => listeners.delete(listener)),
    },
    application: {
      async invokeRaw(invocation) {
        if (fail?.(invocation)) throw new Error('refused');
        invocations.push(invocation);
        return {} as CommandReceipt;
      },
    },
    context: { workspaceId: 'w', principalId: 'scale', grant: { operations: ['weight.ingest'] } },
    ingestOperation: 'weight.ingest',
    events: ['weight.taken'],
    now: () => 42,
  });
  return { fake, supervisor, ingest, invocations, errors, listeners };
}

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 200 && !check(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 5));
};

test('each wanted event runs the ingest command once, keyed by session and sequence', async () => {
  const { fake, supervisor, ingest, invocations, errors } = harness();
  // Starting asks the supervisor for a session: an event-only driver gets no other request.
  ingest.start((error) => errors.push(error));
  await until(() => supervisor.status().state === 'ready');
  const session = supervisor.status().session!;
  fake.emit('tare.pressed');
  fake.emit('weight.taken', { grams: 12 });
  await until(() => invocations.length === 1);
  await ingest.stop();
  fake.emit('weight.taken', { grams: 13 });
  await supervisor.close();
  expect(invocations).toEqual([
    {
      operation: 'weight.ingest',
      idempotencyKey: `driver:scale:${session}:1`,
      input: {
        driver: 'scale',
        session,
        seq: 1,
        name: 'weight.taken',
        payload: { grams: 12 },
        observedAt: 42,
        device: { driver: 'fake-scale', driverVersion: '0.0.0', serial: 'S-1' },
      },
    },
  ]);
  expect(errors).toEqual([]);
});

test('a failed ingest is reported and the next event is still handled', async () => {
  const { fake, supervisor, ingest, invocations, errors } = harness(
    (invocation) => (invocation.input as { seq: number }).seq === 0,
  );
  ingest.start((error) => errors.push(error));
  await supervisor.ready();
  fake.emit('weight.taken', { grams: 1 });
  fake.emit('weight.taken', { grams: 2 });
  await until(() => invocations.length === 1);
  await ingest.stop();
  await supervisor.close();
  expect(errors).toHaveLength(1);
  expect(invocations.map((invocation) => (invocation.input as { seq: number }).seq)).toEqual([1]);
});

test('an undeclared event is refused when the ingest is built', () => {
  expect(() =>
    createDriverEventIngest({
      contract: scale,
      service: { supervisor: () => undefined as never, onEvent: () => () => undefined },
      application: { invokeRaw: async () => ({}) as CommandReceipt },
      context: { workspaceId: 'w', principalId: 'scale' },
      ingestOperation: 'weight.ingest',
      events: ['weight.lost'],
    }),
  ).toThrow('declares no event weight.lost');
});
