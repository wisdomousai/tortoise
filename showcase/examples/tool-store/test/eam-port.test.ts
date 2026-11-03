import { expect, test } from 'bun:test';
import { conformanceEffect, connectorConformance } from '@agent-native/testing/connectors';
import { repairOrderEffect, type RepairOrderPayload } from '../contracts/eam-target';
import { FakeEam, tagList } from '../eam-port';

/** A fresh fake EAM that knows every asset tag but TC-09999, driven as the dispatcher would. */
function harness() {
  const eam = new FakeEam({ unknownTags: ['TC-09999'] });
  let next = 0;
  let version = 0;
  const effect = (assetTag: string) =>
    conformanceEffect({
      id: `effect-${++next}`,
      target: 'eam',
      type: repairOrderEffect,
      payload: { assetTag, returnedBy: 'clerk' } satisfies RepairOrderPayload,
    });
  return Promise.resolve({
    port: eam,
    accepted: () => effect('TC-00601'),
    rejected: () => effect('TC-09999'),
    applied: async (applied: { id: string }) =>
      eam.repairOrders.filter((order) => order.reference === applied.id).length,
    failNext: () => eam.failNext(),
    interruptNext: () => eam.loseNextReply(),
    change: async () =>
      eam.publish({
        assetTag: 'TC-00601',
        description: 'Torque wrench 20-100 Nm',
        category: 'torque-tool',
        bin: 'A-03',
        version: ++version,
      }),
  });
}

for (const check of connectorConformance(harness))
  test(check.name, async () => expect(await check.run()).toEqual({ passed: true }));

test('DEMO_EAM_UNKNOWN_TAGS lists asset tags separated by commas', () => {
  expect(tagList(undefined)).toEqual([]);
  expect(tagList(' TC-00601, ,TC-00602 ')).toEqual(['TC-00601', 'TC-00602']);
});

test('repair order numbers count up and the feed pages from its position', async () => {
  const eam = new FakeEam({ pageSize: 2 });
  const signal = new AbortController().signal;
  for (const id of ['a', 'b'])
    await eam.deliver(
      conformanceEffect({
        id,
        target: 'eam',
        type: repairOrderEffect,
        payload: { assetTag: 'TC-00601', returnedBy: 'clerk' },
      }),
      signal,
    );
  expect(eam.repairOrders.map((order) => order.number)).toEqual(['RO-000001', 'RO-000002']);
  for (let version = 1; version <= 3; version++)
    eam.publish({
      assetTag: 'TC-00601',
      description: 'Torque wrench',
      category: 'torque-tool',
      bin: 'A-03',
      version,
    });
  expect(await eam.pull(undefined)).toMatchObject({ cursor: '2', more: true });
  expect(await eam.pull('2')).toMatchObject({ cursor: '3', more: false });
  await expect(eam.pull('7')).rejects.toThrow('feed position');
});
