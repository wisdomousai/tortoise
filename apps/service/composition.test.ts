import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '../../packages/adapters/src/sqlite';
import {
  createApplicationRuntime,
  createApplicationState,
  upgradeApplicationState,
  type ApplicationState,
} from './src/composition';
import { createApplication } from '@agent-native/runtime';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
} from '../../examples/project-tasks/server';

const owner = { workspaceId: 'local', principalId: 'owner' };

test('a workspace written before module composition keeps its projects after upgrade', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-upgrade-'));
  const path = join(directory, 'workspace.sqlite');
  try {
    // Persist a pre-composition document with the original single-module runtime: project/task
    // state at the root and no outbox.
    const seed = new SQLiteStorage(path, () => createProjectTaskState('owner'));
    await createApplication({
      modules: [projectTasksModule],
      handlers: createProjectTaskHandlers(),
      storage: seed,
      authorization: projectTaskPolicy,
      services: {},
    }).invokeRaw(
      { operation: 'project.create', input: { name: 'Legacy' }, idempotencyKey: 'legacy' },
      owner,
    );
    await seed.close();
    const db = new Database(path);
    const row = db.query('SELECT document FROM workspace_snapshots').get() as { document: string };
    const document = JSON.parse(row.document);
    delete document.effects;
    db.query('UPDATE workspace_snapshots SET document = ?').run(JSON.stringify(document));
    db.close();

    const storage = new SQLiteStorage<ApplicationState>(path, () => createApplicationState(), {
      upgrade: (state) => upgradeApplicationState(state),
    });
    const application = createApplicationRuntime({ storage });
    const projects = await application.queryRaw({ operation: 'project.list', input: {} }, owner);
    expect(JSON.stringify(projects.data)).toContain('Legacy');
    // The quality module starts empty and the owner supervises the default plant.
    const plants = await application.queryRaw(
      { operation: 'inspection.plant.list', input: {} },
      owner,
    );
    expect((plants.data as { items: unknown[] }).items).toEqual([
      { plant: 'P100', role: 'supervisor', members: { owner: 'supervisor' } },
    ]);
    await storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('upgrade is idempotent for already composed state', () => {
  const state = createApplicationState('owner');
  expect(upgradeApplicationState(structuredClone(state))).toEqual(state);
});
