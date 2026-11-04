import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { createApplication, createHandlerFactory, createMemoryStorage } from '@tortoise/runtime';
import { createDirectTransport } from '@tortoise/adapters/direct';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';

const localUser = { workspaceId: 'direct', principalId: 'local-user' };
const customer = { ...localUser, principalId: 'customer' };

async function serviceApp() {
  let id = 0;
  const app = createApplication({
    modules: [fieldServiceModule],
    handlers: createServiceHandlers(),
    storage: createMemoryStorage(createServiceState()),
    authorization: servicePolicy,
    services: { newId: () => `id-${++id}` },
  });
  await app.invokeRaw(
    { operation: 'work-order.create', input: { name: 'Shared' }, idempotencyKey: 'p' },
    localUser,
  );
  await app.invokeRaw(
    {
      operation: 'work-order.set-member',
      input: { id: 'id-1', principalId: 'customer', role: 'customer' },
      idempotencyKey: 'grant',
    },
    localUser,
  );
  return app;
}

test('a per-request signal narrows the launcher cancellation, never replaces it', async () => {
  const app = await serviceApp();
  const launcher = new AbortController();
  launcher.abort();
  const transport = createDirectTransport(app, { ...customer, signal: launcher.signal });
  await expect(
    transport.query('task.list', {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  await expect(
    transport.command(
      'work-order.create',
      { name: 'Late' },
      { idempotencyKey: 'late', signal: new AbortController().signal },
    ),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
});

test('a subscription from a snapshot cursor resets when access changed in between', async () => {
  const app = await serviceApp();
  const transport = createDirectTransport(app, customer, { pollMs: 1 });
  const snapshot = await transport.query('task.list', {});
  // Revoked between the snapshot and the subscription.
  await app.invokeRaw(
    {
      operation: 'work-order.set-member',
      input: { id: 'id-1', principalId: 'customer', role: null },
      idempotencyKey: 'revoke',
    },
    localUser,
  );
  const controller = new AbortController();
  for await (const batch of transport.events(snapshot.cursor, controller.signal)) {
    expect(batch.reset).toBe(true);
    expect(batch.authorizationRevision).toBeGreaterThan(snapshot.authorizationRevision);
    controller.abort();
  }
}, 2_000);

test('a subscription from a current snapshot cursor resumes without a reset', async () => {
  const app = await serviceApp();
  const transport = createDirectTransport(app, customer, { pollMs: 1 });
  const snapshot = await transport.query('task.list', {});
  await app.invokeRaw(
    {
      operation: 'task.create',
      input: { workOrderId: 'id-1', title: 'New' },
      idempotencyKey: 'task',
    },
    localUser,
  );
  const controller = new AbortController();
  for await (const batch of transport.events(snapshot.cursor, controller.signal)) {
    expect(batch.reset).toBe(false);
    expect(batch.changes.map((change) => change.resource)).toContain('task:id-2');
    controller.abort();
  }
}, 2_000);

test('direct receipts carry committed outbox effects like HTTP receipts', async () => {
  const post = defineCapability({
    id: 'note.post',
    kind: 'command',
    input: jsonSchema(z.strictObject({ id: z.string() })),
    output: jsonSchema(z.strictObject({ id: z.string() })),
    permission: { action: 'create', resourceType: 'note' },
    ui: { exception: 'test fixture' },
    integration: { target: 'sor', delivery: 'outbox' },
  });
  const bind = createHandlerFactory<{ notes: string[] }, {}>();
  const app = createApplication({
    modules: [
      defineModule({
        id: 'notes',
        capabilities: [post],
        // An outbox target must use a declared, queuing destination.
        requirements: {
          network: [
            {
              id: 'sor-api',
              purpose: 'Test system of record.',
              direction: 'outbound',
              scope: 'local',
              protocol: 'https',
              targets: ['sor'],
              dataClasses: ['record'],
              availability: 'optional',
              offline: 'queue',
            },
          ],
        },
      }),
    ],
    storage: createMemoryStorage({ notes: [] as string[] }),
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    services: {},
    newEffectId: () => 'effect-1',
    handlers: [
      bind(post, (input, ctx) => {
        ctx.state.notes.push(input.id);
        ctx.enqueue({
          target: 'sor',
          type: 'note.post',
          resource: `note:${input.id}`,
          payload: {},
        });
        ctx.change(`note:${input.id}`);
        return { id: input.id };
      }),
    ],
  });
  const receipt = await createDirectTransport(app, localUser).command(
    'note.post',
    { id: 'n1' },
    { idempotencyKey: 'post-n1' },
  );
  expect(receipt.effects).toEqual(['effect-1']);
});
