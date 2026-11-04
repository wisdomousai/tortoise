import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import { createApplication } from '@tortoise/runtime';
import { createApplicationRuntime, workspaceStorage } from '@tortoise/host';
import fieldService from '../application';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';

const localUser = { workspaceId: 'local', principalId: 'local-user' };

test('a workspace written before module composition keeps its work orders after upgrade', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-upgrade-'));
  const path = join(directory, 'workspace.sqlite');
  try {
    // Persist a pre-composition workspace with the original single-module runtime: work order and
    // task state at the root.
    const seed = new SQLiteStorage(path, () => createServiceState('local-user'));
    await createApplication({
      modules: [fieldServiceModule],
      handlers: createServiceHandlers(),
      storage: seed,
      authorization: servicePolicy,
      services: {},
    }).invokeRaw(
      { operation: 'work-order.create', input: { name: 'Legacy' }, idempotencyKey: 'legacy' },
      localUser,
    );
    await seed.close();

    const storage = workspaceStorage(fieldService, directory);
    const application = createApplicationRuntime(fieldService, { storage });
    const workOrders = await application.queryRaw(
      { operation: 'work-order.list', input: {} },
      localUser,
    );
    expect(JSON.stringify(workOrders.data)).toContain('Legacy');
    await storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('upgrade is idempotent and keeps only this application slice of a composed workspace', () => {
  const state = fieldService.createState('local-user');
  expect(fieldService.upgradeState!(structuredClone(state), 'local-user')).toEqual(state);
  expect(
    fieldService.upgradeState!({ ...structuredClone(state), quality: { lots: {} } }, 'local-user'),
  ).toEqual(state);
});
