import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { featureConformance } from '@tortoise/testing/features';
import { createToolStoreApplication } from '../application';
import { handoverFeature } from '../features/handover/feature';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe('handover feature conformance', () => {
  const entry = {
    id: 'e1',
    shift: 'early',
    text: 'First',
    recordedBy: 'person',
    recordedAt: 0,
  } as const;
  for (const check of featureConformance(handoverFeature(), {
    allowAll: { allows: () => true },
    denyAll: { allows: () => false },
    sampleSlice: { entries: { e1: entry } },
    requests: [
      { operation: 'handover.list', input: {} },
      { operation: 'handover.record', input: { shift: 'late', text: 'Second' } },
    ],
    events: [
      {
        cursor: 1,
        resource: 'handover:e1',
        revision: 1,
        type: 'changed',
        operation: 'handover.record',
      },
    ],
    personOnly: ['handover.record'],
  }))
    test(check.name, check.run);
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-handover-'));
  let ids = 0;
  let clock = 1_000;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer', clerk: 'attendant' },
      services: { newId: () => `entry-${++ids}`, now: () => (clock += 1_000) },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}

const record = (shift: string, text: string) => ({
  operation: 'handover.record',
  input: { shift, text },
  idempotencyKey: text,
});
const list = { operation: 'handover.list', input: {} };

test('attendants record entries, every member reads them latest first, non-members reach neither', async () => {
  const app = await open();
  const first = await app.invokeRaw(
    record('early', 'Torque wrench A-03 is out for calibration'),
    clerk,
  );
  expect(first.result).toMatchObject({
    id: 'entry-1',
    shift: 'early',
    recordedBy: 'clerk',
    recordedAt: 2_000,
  });
  await app.invokeRaw(record('late', 'Bin B-07 is full'), localUser);
  await app.invokeRaw(record('night', 'Door code changed'), clerk);

  for (const caller of [localUser, clerk, viewer]) {
    const listed = await app.queryRaw(list, caller);
    expect((listed.data as { items: { text: string }[] }).items.map((item) => item.text)).toEqual([
      'Door code changed',
      'Bin B-07 is full',
      'Torque wrench A-03 is out for calibration',
    ]);
  }
  await expect(app.invokeRaw(record('early', 'Viewer note'), viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(app.queryRaw(list, stranger)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(app.invokeRaw(record('early', 'Stranger note'), stranger)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test('an entry needs a known shift and a text', async () => {
  const app = await open();
  await expect(app.invokeRaw(record('morning', 'Wrong shift'), clerk)).rejects.toBeDefined();
  await expect(app.invokeRaw(record('early', ''), clerk)).rejects.toBeDefined();
});

test('an agent run cannot record an entry, even for an attendant', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(record('early', 'From an agent'), { ...clerk, runId: 'run-1' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const listed = await app.queryRaw(list, clerk);
  expect((listed.data as { items: unknown[] }).items).toEqual([]);
});
