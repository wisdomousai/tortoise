import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';
import type { EamTool } from '../contracts/eam-target';
import { FakeEam } from '../eam-port';

const owner = { workspaceId: 'local', principalId: 'owner' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * Tool `id-1` (TC-00601) lent to E004217 on loan `id-2`, in a workspace whose EAM is the fake.
 * Nothing runs in the background: each test drives the dispatcher and the inbound sync itself.
 */
async function open(unknownTags: string[] = []) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-eam-'));
  const eam = new FakeEam({ unknownTags });
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer', clerk: 'attendant' },
      eam,
      services: { newId: () => `id-${++ids}`, now: () => 2_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const { application, integrations } = instance;
  await application.invokeRaw(
    {
      operation: 'tool.create',
      input: {
        assetTag: 'TC-00601',
        description: 'Torque wrench 20-100 Nm',
        category: 'torque-tool',
        bin: 'A-03',
        calibrationDue: '2026-12-01',
      },
      idempotencyKey: 'seed',
    },
    owner,
  );
  await application.invokeRaw(
    {
      operation: 'tool.check-out',
      input: {
        toolId: 'id-1',
        borrower: 'E004217',
        workOrder: 'WO-100',
        dueAt: '2026-11-05T16:00:00Z',
      },
      idempotencyKey: 'out',
    },
    owner,
  );
  const target = integrations.target('eam');
  return {
    eam,
    app: application,
    integrations,
    /** The EAM connector's own identity, limited to the target's operations. */
    connector: target.context,
    /** One dispatcher pass. Backoff is ignored, as if the retry delay had passed. */
    deliver: () => target.dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true }),
    returnTool: (condition: 'ok' | 'damaged', note?: string) =>
      application.invokeRaw(
        {
          operation: 'tool.return',
          input: { toolId: 'id-1', condition, ...(note ? { note } : {}) },
          idempotencyKey: `return-${condition}`,
        },
        clerk,
      ),
    loan: async () =>
      (await application.queryRaw({ operation: 'loan.get', input: { id: 'id-2' } }, viewer)).data,
    tool: async () =>
      (await application.queryRaw({ operation: 'tool.get', input: { id: 'id-1' } }, viewer)).data,
    status: async () =>
      (await application.queryRaw({ operation: 'eam.sync.status', input: {} }, viewer)).data,
    held: async (as = viewer) =>
      (
        (await application.queryRaw({ operation: 'reconciliation.list', input: {} }, as)).data as {
          items: { id: string }[];
        }
      ).items,
    resolve: (input: object, as = clerk) =>
      application.invokeRaw(
        { operation: 'reconciliation.resolve', input, idempotencyKey: `resolve-${as.principalId}` },
        as,
      ),
  };
}

const idle = { accepted: 0, rejected: 0, retried: 0, deferred: 0, held: 0, acknowledged: 0 };

test('a damaged return sends a repair order and the loan records the EAM number', async () => {
  const { eam, deliver, returnTool, loan, status } = await open();
  const receipt = await returnTool('damaged', ' ratchet slips ');
  const effectId = (receipt.result as { repairOrder: { effectId: string } }).repairOrder.effectId;
  // The receipt proves the local commit only: the EAM has not answered yet.
  expect(receipt.result).toMatchObject({ repairOrder: { effectId, sync: 'pending' } });
  expect(eam.repairOrders).toEqual([]);

  expect(await deliver()).toMatchObject({ accepted: 1 });
  expect(eam.repairOrders).toEqual([
    {
      number: 'RO-000001',
      reference: effectId,
      assetTag: 'TC-00601',
      note: 'ratchet slips',
      reportedBy: 'clerk',
    },
  ]);
  expect(await loan()).toMatchObject({
    condition: 'damaged',
    repairOrder: { effectId, sync: 'accepted', sorRef: 'RO-000001' },
  });
  expect(await status()).toEqual({ pending: 0, held: 0, accepted: 1, rejected: 0 });
  expect(await deliver()).toEqual(idle);
});

test('an ok return sends no repair order', async () => {
  const { eam, deliver, returnTool, loan } = await open();
  await returnTool('ok');
  expect(await loan()).not.toHaveProperty('repairOrder');
  expect(await deliver()).toEqual(idle);
  expect(eam.repairOrders).toEqual([]);
});

test('the EAM refuses an asset tag it does not know with ASSET_UNKNOWN, once', async () => {
  const { eam, deliver, returnTool, loan, tool, status } = await open(['TC-00601']);
  await returnTool('damaged');
  expect(await deliver()).toMatchObject({ rejected: 1, retried: 0 });
  const recorded = (await loan()) as { repairOrder: object };
  expect(recorded.repairOrder).toMatchObject({
    sync: 'rejected',
    rejection: { code: 'ASSET_UNKNOWN', message: 'The EAM has no asset TC-00601' },
  });
  expect(recorded.repairOrder).not.toHaveProperty('sorRef');
  // A refusal is the EAM's decision: it is not sent again and the tool stays in repair.
  expect(await deliver()).toEqual(idle);
  expect(eam.repairOrders).toEqual([]);
  expect(await tool()).toMatchObject({ status: 'in-repair' });
  expect(await status()).toEqual({ pending: 0, held: 0, accepted: 0, rejected: 1 });
});

test('a lost reply is held, not sent again, and a person records the number they found', async () => {
  const { eam, deliver, returnTool, loan, status, held, resolve } = await open();
  eam.loseNextReply();
  const receipt = await returnTool('damaged', 'cracked housing');
  const effectId = (receipt.result as { repairOrder: { effectId: string } }).repairOrder.effectId;

  // The first pass loses the reply and retries. Before sending again the dispatcher looks the
  // request up, and the EAM's log has no answer, so it holds the repair order.
  expect(await deliver()).toMatchObject({ retried: 1 });
  expect(await deliver()).toMatchObject({ held: 1 });
  expect(await deliver()).toEqual(idle);
  expect(eam.repairOrders).toHaveLength(1);
  expect(await status()).toMatchObject({ pending: 1, held: 1 });
  expect(await loan()).toMatchObject({ repairOrder: { effectId, sync: 'pending' } });
  expect(await held()).toEqual([
    expect.objectContaining({
      id: effectId,
      target: 'eam',
      type: 'repair-order.create',
      resource: 'loan:id-2',
      payload: { assetTag: 'TC-00601', note: 'cracked housing', returnedBy: 'clerk' },
      holdReason: expect.stringContaining('TC-00601'),
    }),
  ]);

  // Viewers read held repair orders but do not decide, and neither does an agent run.
  await expect(resolve({ effectId, decision: 'applied' }, viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    resolve({ effectId, decision: 'applied' }, { ...clerk, runId: 'run-1' } as typeof clerk),
  ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'PERSON_ONLY' });

  const number = eam.repairOrders[0]!.number;
  const decided = await resolve({ effectId, decision: 'applied', externalRef: number });
  expect(decided.result).toEqual({ effectId, status: 'accepted' });
  expect(await loan()).toMatchObject({
    repairOrder: { effectId, sync: 'accepted', sorRef: 'RO-000001' },
  });
  expect(await held()).toEqual([]);
  expect(await status()).toEqual({ pending: 0, held: 0, accepted: 1, rejected: 0 });
  expect(await deliver()).toEqual(idle);
  expect(eam.repairOrders).toHaveLength(1);
});

test('a held repair order the EAM did not open is sent again when a person says so', async () => {
  const { eam, deliver, returnTool, loan, held, resolve } = await open();
  eam.loseNextReply({ opened: false });
  await returnTool('damaged');
  await deliver();
  expect(await deliver()).toMatchObject({ held: 1 });
  const [effect] = await held();

  const decided = await resolve({ effectId: effect!.id, decision: 'not-applied' });
  expect(decided.result).toEqual({ effectId: effect!.id, status: 'pending' });
  expect(await loan()).toMatchObject({ repairOrder: { sync: 'pending' } });
  // The release tells the lookup a person decided, so the same missing answer does not hold it.
  expect(await deliver()).toMatchObject({ accepted: 1, held: 0 });
  expect(eam.repairOrders).toHaveLength(1);
  expect(await loan()).toMatchObject({ repairOrder: { sync: 'accepted', sorRef: 'RO-000001' } });
});

test('a held repair order a person marks refused records their reason', async () => {
  const { eam, deliver, returnTool, loan, held, resolve } = await open();
  eam.loseNextReply();
  await returnTool('damaged');
  await deliver();
  await deliver();
  const [effect] = await held();
  await resolve({ effectId: effect!.id, decision: 'refused', reason: 'Asset is scrapped in EAM' });
  expect(await loan()).toMatchObject({
    repairOrder: {
      sync: 'rejected',
      rejection: { code: 'RECONCILED_REFUSED', message: 'Asset is scrapped in EAM' },
    },
  });
  expect(await deliver()).toEqual(idle);
});

const master = (fields: Partial<EamTool> & Pick<EamTool, 'version'>): EamTool => ({
  assetTag: 'TC-00601',
  description: 'Torque wrench 40-200 Nm',
  category: 'torque-tool',
  bin: 'B-07',
  calibrationDue: '2027-03-01',
  ...fields,
});

test('the feed updates master data by asset tag, never status, and drops a stale item', async () => {
  const { eam, app, integrations, tool, status } = await open();
  eam.publish(master({ version: 5 }));
  // An asset the store does not hold adds no tool.
  eam.publish(master({ assetTag: 'TC-07777', version: 1 }));
  // An older version after a newer one in the same batch is dropped.
  eam.publish(master({ bin: 'Z-99', version: 4 }));
  expect(await integrations.sync()).toEqual([{ target: 'eam', batches: 1, items: 3 }]);
  expect(await tool()).toMatchObject({
    assetTag: 'TC-00601',
    description: 'Torque wrench 40-200 Nm',
    bin: 'B-07',
    calibrationDue: '2027-03-01',
    status: 'checked-out',
  });
  const list = await app.queryRaw({ operation: 'tool.list', input: {} }, viewer);
  expect(list.data).toMatchObject({ total: 1 });
  expect(await status()).toMatchObject({ watermark: '3', lastSyncAt: 2_000 });

  // A replayed older version in a later batch is dropped too; a newer one clears the date.
  eam.publish(master({ bin: 'Z-98', version: 5 }));
  await integrations.sync();
  expect(await tool()).toMatchObject({ bin: 'B-07' });
  const { calibrationDue: _planned, ...unplanned } = master({ bin: 'B-08', version: 6 });
  eam.publish(unplanned);
  await integrations.sync();
  const updated = await tool();
  expect(updated).toMatchObject({ bin: 'B-08', status: 'checked-out' });
  expect(updated).not.toHaveProperty('calibrationDue');
});

test('a stale feed range conflicts and changes nothing', async () => {
  const { eam, app, integrations, connector, tool, status } = await open();
  eam.publish(master({ version: 1 }));
  await integrations.sync();
  // A second puller that read the watermark before the first pass applies the same range again.
  await expect(
    app.invokeRaw(
      {
        operation: 'eam.sync',
        input: { to: '1', items: [master({ bin: 'Z-99', version: 9 })] },
        idempotencyKey: 'stale-range',
      },
      connector,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await tool()).toMatchObject({ bin: 'B-07' });
  expect(await status()).toMatchObject({ watermark: '1' });
});

test('only the connector completes and syncs, and it can do nothing else', async () => {
  const { app, connector, returnTool } = await open();
  const receipt = await returnTool('damaged');
  const effectId = (receipt.result as { repairOrder: { effectId: string } }).repairOrder.effectId;
  const complete = {
    operation: 'eam.effect.complete',
    input: { effectId, outcome: { status: 'accepted', externalRef: 'RO-999999' } },
    idempotencyKey: 'forged',
  };
  await expect(app.invokeRaw(complete, owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.invokeRaw(
      { operation: 'eam.sync', input: { to: '1', items: [] }, idempotencyKey: 'sync' },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.create',
        input: { assetTag: 'TC-00602', description: 'Gauge', category: 'gauge', bin: 'A-01' },
        idempotencyKey: 'create',
      },
      connector,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'tool.list', input: {} }, connector),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'reconciliation.list', input: {} }, connector),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
