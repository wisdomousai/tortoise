import { describe, expect, test } from 'bun:test';
import { createApplication, createMemoryStorage, type ExecutionContext } from '@tortoise/runtime';
import { qualityPeerApi } from '../contracts/peer';
import {
  createQualityHandlers,
  createQualityState,
  qualityInspectionModule,
  qualityPolicy,
} from '../server';

const workspaceId = 'plant-floor';
const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
/** A peer as the peer link resolves it: its service principal with the API's grant. */
const peer = (id: string): ExecutionContext => ({
  workspaceId,
  principalId: `peer:${id}`,
  peer: { id },
  grant: { operations: [...qualityPeerApi.serviceOperations] },
});
const line = (delivery: string) => ({
  delivery,
  purchaseOrder: 'PO-1',
  supplier: 'Acme Brakes',
  sku: 'BRK-220',
  description: 'Brake disc 220 mm',
  quantity: 10,
});

async function setup() {
  let ids = 0;
  let keys = 0;
  const app = createApplication({
    modules: [qualityInspectionModule],
    handlers: createQualityHandlers(),
    storage: createMemoryStorage(createQualityState({ supervisorId: 'supervisor' })),
    authorization: qualityPolicy,
    services: { newId: () => `a-${++ids}`, now: () => 1_000 },
  });
  const command = async (operation: string, input: unknown, context: ExecutionContext) =>
    (await app.invokeRaw({ operation, input, idempotencyKey: `k-${++keys}` }, context))
      .result as Record<string, any>;
  const query = async (operation: string, input: unknown, context: ExecutionContext) =>
    (await app.queryRaw({ operation, input }, context)).data as Record<string, any>;
  for (const [principalId, role] of [
    ['ina', 'inspector'],
    ['vic', 'viewer'],
  ] as const)
    await command(
      'inspection.plant.set-member',
      { plant: 'P100', principalId, role },
      as('supervisor'),
    );
  return { command, query };
}

describe('inspection requests', () => {
  test('each peer reads only the outcomes of its own requests, in order, from its cursor', async () => {
    const { command, query } = await setup();
    const first = await command('inspection.request.create', line('L1'), peer('a'));
    const other = await command('inspection.request.create', line('L1'), peer('b'));
    const second = await command('inspection.request.create', line('L2'), peer('a'));
    expect(new Set([first.id, other.id, second.id]).size).toBe(3);
    for (const id of [second.id, other.id, first.id])
      await command('inspection.request.close', { id, outcome: 'accepted' }, as('ina'));

    const page = await query('inspection.request.feed', {}, peer('a'));
    expect(page).toEqual({
      items: [
        { id: second.id, delivery: 'L2', outcome: 'accepted', closedAt: 1_000 },
        { id: first.id, delivery: 'L1', outcome: 'accepted', closedAt: 1_000 },
      ],
      cursor: '3',
    });
    expect(await query('inspection.request.feed', { cursor: page.cursor }, peer('a'))).toEqual({
      items: [],
      cursor: '3',
    });
    expect((await query('inspection.request.feed', {}, peer('b'))).items).toEqual([
      { id: other.id, delivery: 'L1', outcome: 'accepted', closedAt: 1_000 },
    ]);
  });

  test('a delivery sent again while open gets its open request', async () => {
    const { command, query } = await setup();
    const first = await command('inspection.request.create', line('L1'), peer('a'));
    expect(await command('inspection.request.create', line('L1'), peer('a'))).toEqual(first);
    await command('inspection.request.close', { id: first.id, outcome: 'rejected' }, as('ina'));
    const again = await command('inspection.request.create', line('L1'), peer('a'));
    expect(again.id).not.toBe(first.id);
    expect((await query('inspection.request.list', {}, as('ina'))).total).toBe(2);
  });

  test('people who capture close requests once; peers and people only do their own part', async () => {
    const { command, query } = await setup();
    const { id } = await command('inspection.request.create', line('L1'), peer('a'));
    await expect(
      command('inspection.request.close', { id, outcome: 'accepted' }, as('vic')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      command('inspection.request.close', { id, outcome: 'accepted' }, peer('a')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(command('inspection.request.create', line('L2'), as('ina'))).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(query('inspection.request.feed', {}, as('ina'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await query('inspection.request.list', {}, as('vic'))).items).toEqual([]);

    expect(
      await command(
        'inspection.request.close',
        { id, outcome: 'accepted', note: 'Fine' },
        as('ina'),
      ),
    ).toMatchObject({ status: 'closed', outcome: 'accepted', note: 'Fine', closedBy: 'ina' });
    await expect(
      command('inspection.request.close', { id, outcome: 'rejected' }, as('ina')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
