import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import { SnapshotStorage } from '@agent-native/adapters/snapshot-storage';
import { createApplication } from '@agent-native/runtime';
import { createApplicationRuntime, workspaceStorage } from '@agent-native/host';
import fieldService from '../application';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';

const owner = { workspaceId: 'local', principalId: 'owner' };

test('a workspace written before module composition keeps its work orders after upgrade', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-upgrade-'));
  const path = join(directory, 'workspace.sqlite');
  try {
    // Persist a pre-composition document with the original single-module runtime: work order/task
    // state at the root and no outbox.
    // The version 1 layout: one JSON document per workspace, converted to rows on the next open.
    const seed = new SnapshotStorage(bunSqlDriver(path), () => createServiceState('owner'));
    await createApplication({
      modules: [fieldServiceModule],
      handlers: createServiceHandlers(),
      storage: seed,
      authorization: servicePolicy,
      services: {},
    }).invokeRaw(
      { operation: 'work-order.create', input: { name: 'Legacy' }, idempotencyKey: 'legacy' },
      owner,
    );
    await seed.close();
    const db = new Database(path);
    const row = db.query('SELECT document FROM workspace_snapshots').get() as { document: string };
    const document = JSON.parse(row.document);
    delete document.effects;
    db.query('UPDATE workspace_snapshots SET document = ?').run(JSON.stringify(document));
    db.close();

    const storage = workspaceStorage(fieldService, directory);
    const application = createApplicationRuntime(fieldService, { storage });
    const workOrders = await application.queryRaw(
      { operation: 'work-order.list', input: {} },
      owner,
    );
    expect(JSON.stringify(workOrders.data)).toContain('Legacy');
    await storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('upgrade is idempotent and keeps only this application slice of a composed workspace', () => {
  const state = fieldService.createState('owner');
  expect(fieldService.upgradeState!(structuredClone(state), 'owner')).toEqual(state);
  expect(
    fieldService.upgradeState!({ ...structuredClone(state), quality: { lots: {} } }, 'owner'),
  ).toEqual(state);
});
