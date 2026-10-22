import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import type { ApprovalRequest } from '@agent-native/contracts';
import { LOCAL_WORKSPACE, createApplicationRuntime, workspaceStorage } from '@agent-native/host';
import type { ExecutionContext } from '@agent-native/runtime';
import projectTasks from '../application';

const WORKSPACE_DATABASE = 'workspace.sqlite';
const as = (principalId: string): ExecutionContext => ({
  workspaceId: LOCAL_WORKSPACE,
  principalId,
});
const owner = as('owner');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const project = { id: 'p1', name: 'Launch', archived: false, members: { vic: 'viewer' as const } };
/** A version 1 approval request about the project, kept in the task state. */
const pending: ApprovalRequest = {
  id: 'a1',
  operation: 'task.create',
  input: { projectId: 'p1', title: 'Book the venue' },
  rationale: 'The brief lists a venue',
  resource: 'project:p1',
  baseRevisions: {},
  status: 'pending',
  requestedBy: 'owner',
  createdAt: 0,
  expiresAt: 4_000_000_000_000,
};
const slice = {
  workspaceOwnerId: 'owner',
  projects: { p1: project },
  tasks: {},
  deletedTasks: {},
  approvals: { a1: pending },
  reminderEffects: {},
};

/** A workspace directory holding `stored` as its version 1 state. */
async function workspace(stored: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'project-tasks-migration-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const raw = new SQLiteStorage(join(directory, WORKSPACE_DATABASE), () => stored);
  await raw.transact(LOCAL_WORKSPACE, async () => {});
  await raw.close();
  const open = () => {
    const storage = workspaceStorage(projectTasks, directory);
    cleanup.push(() => storage.close());
    return createApplicationRuntime(projectTasks, { storage });
  };
  return { directory, open };
}

const listed = async (
  application: ReturnType<typeof createApplicationRuntime>,
  as: ExecutionContext,
) =>
  (
    (await application.queryRaw({ operation: 'approval.list', input: {} }, as)).data as {
      items: ApprovalRequest[];
    }
  ).items.map((item) => item.id);

describe('project-tasks state version 2', () => {
  for (const [layout, stored] of [
    ['under projectTasks', { projectTasks: slice }],
    ['at the root, from before modules were composed', slice],
  ] as const)
    test(`approval requests stored ${layout} move into the approval feature`, async () => {
      const { directory, open } = await workspace(structuredClone(stored));
      const application = open();
      expect(await listed(application, as('vic'))).toEqual(['a1']);
      await application.invokeRaw({ operation: 'approval.approve', input: { id: 'a1' } }, owner);
      const tasks = await application.queryRaw(
        { operation: 'task.list', input: { projectId: 'p1' } },
        owner,
      );
      expect(JSON.stringify(tasks.data)).toContain('Book the venue');
      const raw = new SQLiteStorage<Record<string, any>>(
        join(directory, WORKSPACE_DATABASE),
        () => ({}),
      );
      const snapshot = await raw.read(LOCAL_WORKSPACE, async (s) => structuredClone(s));
      await raw.close();
      expect(snapshot.state.projectTasks).not.toHaveProperty('approvals');
      expect(snapshot.state).not.toHaveProperty('approvals');
      expect(snapshot.state.approval.requests.a1).toMatchObject({ status: 'approved' });
      expect(snapshot.stateVersions).toMatchObject({
        application: { version: 2, readableFrom: 2 },
        'feature:approval': { version: 1, readableFrom: 1 },
      });
    });

  test('a non-member cannot list, request or decide, and a viewer cannot reject', async () => {
    const { open } = await workspace({ projectTasks: slice });
    const application = open();
    const stranger = as('stranger');
    await expect(
      application.queryRaw({ operation: 'approval.list', input: {} }, stranger),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      application.invokeRaw(
        {
          operation: 'approval.request',
          input: {
            operation: pending.operation,
            input: pending.input,
            rationale: pending.rationale,
            resource: pending.resource,
            baseRevisions: {},
          },
        },
        stranger,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      application.invokeRaw({ operation: 'approval.approve', input: { id: 'a1' } }, stranger),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      application.invokeRaw({ operation: 'approval.reject', input: { id: 'a1' } }, as('vic')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
