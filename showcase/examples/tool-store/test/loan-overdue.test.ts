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

/** The fixed time the query runs. */
const NOW = Date.parse('2026-11-05T12:00:00Z');
const minute = 60_000;
const at = (offset: number) => new Date(NOW + offset).toISOString();

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-loan-overdue-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++ids}`, now: () => NOW },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}
type App = Awaited<ReturnType<typeof open>>;

/** Create a tool and lend it; returns the tool key. A tool takes the next id, its loan the one after. */
async function lend(app: App, n: number, borrower: string, dueAt: string) {
  const tag = `TC-0060${n}`;
  const created = await app.invokeRaw(
    {
      operation: 'tool.create',
      input: { assetTag: tag, description: `Tool ${n}`, category: 'hand-tool', bin: 'A-01' },
      idempotencyKey: `create-${n}`,
    },
    localUser,
  );
  const toolId = (created.result as { id: string }).id;
  await app.invokeRaw(
    {
      operation: 'tool.check-out',
      input: { toolId, borrower, workOrder: `WO-${n}`, dueAt },
      idempotencyKey: `out-${n}`,
    },
    localUser,
  );
  return toolId;
}

const overdue = async (app: App, input: object = {}, caller = localUser) =>
  (await app.queryRaw({ operation: 'loan.overdue', input }, caller)).data as {
    items: { assetTag: string; description: string; borrower: string }[];
    total: number;
  };

test('lists a loan due one minute ago, leaves out one due in a minute and a returned one', async () => {
  const app = await open();
  await lend(app, 1, 'E000001', at(-minute));
  await lend(app, 2, 'E000002', at(minute));
  const returned = await lend(app, 3, 'E000003', at(-minute));
  await app.invokeRaw(
    {
      operation: 'tool.return',
      input: { toolId: returned, condition: 'ok' },
      idempotencyKey: 'in-3',
    },
    localUser,
  );
  const page = await overdue(app);
  expect(page.total).toBe(1);
  expect(page.items).toMatchObject([
    { assetTag: 'TC-00601', description: 'Tool 1', borrower: 'E000001', workOrder: 'WO-1' },
  ]);
});

test('a loan due exactly now is not yet overdue', async () => {
  const app = await open();
  await lend(app, 1, 'E000001', at(0));
  expect(await overdue(app)).toMatchObject({ total: 0, items: [] });
});

test('oldest due first, comparing instants across offsets', async () => {
  const app = await open();
  // 11:00Z written with an offset sorts as text after 10:30Z, but is the later instant.
  await lend(app, 1, 'E000001', '2026-11-05T12:00:00+01:00');
  await lend(app, 2, 'E000002', '2026-11-05T10:30:00Z');
  await lend(app, 3, 'E000003', '2026-11-05T09:00:00Z');
  const tags = (await overdue(app)).items.map((item) => item.assetTag);
  expect(tags).toEqual(['TC-00603', 'TC-00602', 'TC-00601']);
});

test('filters by borrower and pages after filtering, so total counts the filtered rows', async () => {
  const app = await open();
  await lend(app, 1, 'E000001', at(-3 * minute));
  await lend(app, 2, 'E000002', at(-2 * minute));
  await lend(app, 3, 'E000001', at(-minute));
  expect(await overdue(app, { borrower: 'E000001' })).toMatchObject({
    total: 2,
    items: [{ assetTag: 'TC-00601' }, { assetTag: 'TC-00603' }],
  });
  expect(await overdue(app, { borrower: 'E000001', offset: 1, limit: 1 })).toMatchObject({
    total: 2,
    items: [{ assetTag: 'TC-00603' }],
  });
  expect(await overdue(app, { limit: 1 })).toMatchObject({
    total: 3,
    items: [{ assetTag: 'TC-00601' }],
  });
});

test('a viewer can call it; a caller who is not a member and bad input are refused', async () => {
  const app = await open();
  await lend(app, 1, 'E000001', at(-minute));
  expect(await overdue(app, {}, viewer)).toMatchObject({ total: 1 });
  await expect(
    app.queryRaw({ operation: 'loan.overdue', input: {} }, outsider),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'loan.overdue', input: { borrower: 'E42' } }, localUser),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
