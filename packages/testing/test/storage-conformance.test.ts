import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication, createMemoryStorage, type Storage } from '@agent-native/runtime';
import { errorEnvelope } from '@agent-native/contracts';
import { SQLiteStorage } from '../../adapters/src/sqlite';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
} from '../../../examples/project-tasks/server';
import type { ProjectTaskState } from '../../../examples/project-tasks/domain';
import { assertEquivalent, directDriver, type ScenarioDriver } from '../src/index';

async function scenario(driver: ScenarioDriver) {
  const owner = { workspaceId: 'conformance', principalId: 'owner' };
  const editor = { ...owner, principalId: 'editor' };
  const outcomes: unknown[] = [];
  outcomes.push(
    await driver.command(
      { operation: 'project.create', input: { name: 'Independent' }, idempotencyKey: 'project' },
      owner,
    ),
  );
  outcomes.push(
    await driver.command(
      {
        operation: 'project.set-member',
        input: { id: 'id-1', principalId: 'editor', role: 'editor' },
        idempotencyKey: 'membership',
      },
      owner,
    ),
  );
  outcomes.push(
    await driver.command(
      {
        operation: 'task.create',
        input: { projectId: 'id-1', title: 'Shared', privateNote: 'hidden' },
        idempotencyKey: 'task',
      },
      owner,
    ),
  );
  outcomes.push(await driver.query({ operation: 'task.list', input: {} }, editor));
  const edit = {
    operation: 'task.update',
    input: { id: 'id-2', title: 'Committed' },
    expectedRevisions: { 'task:id-2': 1 },
    idempotencyKey: 'edit',
  };
  outcomes.push(await driver.command(edit, editor));
  outcomes.push(await driver.command(edit, editor));
  outcomes.push(
    await driver.command(
      {
        operation: 'project.set-member',
        input: { id: 'id-1', principalId: 'editor', role: null },
        idempotencyKey: 'revoke',
      },
      owner,
    ),
  );
  try {
    await driver.command(edit, editor);
    throw new Error('Revoked replay unexpectedly succeeded');
  } catch (error) {
    outcomes.push(errorEnvelope(error));
  }
  outcomes.push(await driver.query({ operation: 'task.list', input: {} }, editor));
  return outcomes;
}

test('independent project workflow has identical memory and SQLite outcomes after revocation and retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-storage-conformance-'));
  const durable = new SQLiteStorage(join(directory, 'workspace.sqlite'), createProjectTaskState);
  try {
    const run = async (storage: Storage<ProjectTaskState>) => {
      let id = 0;
      const app = createApplication({
        modules: [projectTasksModule],
        handlers: createProjectTaskHandlers(),
        storage,
        authorization: projectTaskPolicy,
        services: { newId: () => `id-${++id}` },
      });
      const outcomes = await scenario(directDriver(app));
      expect(JSON.stringify(outcomes[3])).not.toContain('hidden');
      expect(outcomes[7]).toMatchObject({ code: 'FORBIDDEN' });
      expect(
        (await app.events(0, { workspaceId: 'conformance', principalId: 'editor' })).events,
      ).toEqual([]);
      return outcomes;
    };
    assertEquivalent(await run(createMemoryStorage(createProjectTaskState())), await run(durable));
  } finally {
    await durable.close();
    await rm(directory, { recursive: true, force: true });
  }
});
