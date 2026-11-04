import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const outsider = { workspaceId: 'local', principalId: 'outsider' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The fixed time the query runs: 5 November 2026, UTC. */
const NOW = Date.parse('2026-11-05T12:00:00Z');

async function open(now = NOW) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-calibration-due-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++ids}`, now: () => now },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}
type App = Awaited<ReturnType<typeof open>>;

/** Add tool TC-0060<n>, due for calibration on `due` when given; returns its key. */
async function add(app: App, n: number, due?: string) {
  const receipt = await app.invokeRaw(
    {
      operation: 'tool.create',
      input: {
        assetTag: `TC-0060${n}`,
        description: `Gauge ${n}`,
        category: 'gauge',
        bin: 'A-01',
        ...(due ? { calibrationDue: due } : {}),
      },
      idempotencyKey: `create-${n}`,
    },
    localUser,
  );
  return (receipt.result as { id: string }).id;
}

async function run(app: App, operation: string, input: object, key: string) {
  await app.invokeRaw({ operation, input, idempotencyKey: key }, localUser);
}

const due = async (app: App, input: object = {}, caller = localUser) =>
  (await app.queryRaw({ operation: 'tool.calibration-due', input }, caller)).data as {
    items: { assetTag: string; status: string; calibrationDue: string }[];
    total: number;
    through: string;
  };
const tags = (page: { items: { assetTag: string }[] }) => page.items.map((item) => item.assetTag);

test('lists tools due through today plus 14 days, soonest first, past dates included', async () => {
  const app = await open();
  await add(app, 1, '2026-11-19'); // today plus 14: the last day included
  await add(app, 2, '2026-11-20'); // one day too late
  await add(app, 3, '2026-10-31'); // past its date
  await add(app, 4, '2026-11-05'); // today
  await add(app, 5); // no calibration date
  const page = await due(app);
  expect(page.through).toBe('2026-11-19');
  expect(page.total).toBe(3);
  expect(tags(page)).toEqual(['TC-00603', 'TC-00604', 'TC-00601']);
});

test('days sets the window; 0 and 91 are refused', async () => {
  const app = await open();
  await add(app, 1, '2026-11-06');
  await add(app, 2, '2026-11-07');
  await add(app, 3, '2027-02-03'); // today plus 90
  expect(await due(app, { days: 1 })).toMatchObject({ through: '2026-11-06', total: 1 });
  expect(tags(await due(app, { days: 2 }))).toEqual(['TC-00601', 'TC-00602']);
  expect(await due(app, { days: 90 })).toMatchObject({ through: '2027-02-03', total: 3 });
  for (const days of [0, 91, 1.5])
    await expect(
      app.queryRaw({ operation: 'tool.calibration-due', input: { days } }, localUser),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('today is the UTC date of the instance clock', async () => {
  // One minute before midnight UTC: today is still 5 November.
  const app = await open(Date.parse('2026-11-05T23:59:00Z'));
  await add(app, 1, '2026-11-06');
  await add(app, 2, '2026-11-07');
  expect(await due(app, { days: 1 })).toMatchObject({
    through: '2026-11-06',
    total: 1,
    items: [{ assetTag: 'TC-00601' }],
  });
});

test('leaves out retired tools and keeps lent, missing and in-repair ones', async () => {
  const app = await open();
  const lent = await add(app, 1, '2026-11-01');
  const retired = await add(app, 2, '2026-11-02');
  const missing = await add(app, 3, '2026-11-03');
  const repaired = await add(app, 4, '2026-11-04');
  await run(
    app,
    'tool.check-out',
    { toolId: lent, borrower: 'E000001', workOrder: 'WO-1', dueAt: '2026-11-06T12:00:00Z' },
    'out-1',
  );
  await run(app, 'tool.retire', { toolId: retired }, 'retire-2');
  await run(app, 'tool.mark-missing', { toolId: missing }, 'missing-3');
  await run(
    app,
    'tool.check-out',
    { toolId: repaired, borrower: 'E000004', workOrder: 'WO-4', dueAt: '2026-11-06T12:00:00Z' },
    'out-4',
  );
  await run(app, 'tool.return', { toolId: repaired, condition: 'damaged' }, 'in-4');
  const page = await due(app);
  expect(page.total).toBe(3);
  expect(page.items).toMatchObject([
    { assetTag: 'TC-00601', status: 'checked-out' },
    { assetTag: 'TC-00603', status: 'missing' },
    { assetTag: 'TC-00604', status: 'in-repair' },
  ]);
});

test('filters before paging, so total counts every match and pages keep one order', async () => {
  const app = await open();
  await add(app, 1, '2026-11-10');
  await add(app, 2, '2026-12-31'); // outside the window, before or after paging
  await add(app, 3, '2026-11-08');
  await add(app, 4, '2026-11-08'); // the same day as TC-00603: the asset tag orders them
  await add(app, 5, '2026-11-09');
  const first = await due(app, { limit: 2 });
  const second = await due(app, { offset: 2, limit: 2 });
  expect(first).toMatchObject({ total: 4 });
  expect(second).toMatchObject({ total: 4 });
  expect([...tags(first), ...tags(second)]).toEqual([
    'TC-00603',
    'TC-00604',
    'TC-00605',
    'TC-00601',
  ]);
  expect(await due(app, { offset: 4 })).toMatchObject({ total: 4, items: [] });
});

test('a viewer can call it; a caller who is not a member is refused', async () => {
  const app = await open();
  await add(app, 1, '2026-11-06');
  expect(await due(app, {}, viewer)).toMatchObject({ total: 1 });
  await expect(
    app.queryRaw({ operation: 'tool.calibration-due', input: {} }, outsider),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
