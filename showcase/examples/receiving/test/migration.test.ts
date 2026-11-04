import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import type { ApprovalRequest } from '@tortoise/contracts';
import { LOCAL_WORKSPACE, openEmbeddedInstance } from '@tortoise/host';
import type { ExecutionContext } from '@tortoise/runtime';
import { createReceivingApplication } from '../application';
import { erpFolders } from '../contracts/erp-target';

const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: 'local-user' };
const viewer = { workspaceId: LOCAL_WORKSPACE, principalId: 'viewer' };
const erp = { workspaceId: LOCAL_WORKSPACE, principalId: 'erp-integration' };
const stranger = { workspaceId: LOCAL_WORKSPACE, principalId: 'stranger' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** A version 1 approval request, kept in the application's own `approvals`. */
const pending: ApprovalRequest = {
  id: 'a1',
  operation: 'delivery.classify',
  input: { id: 'ASN-1', reason: 'short' },
  rationale: 'Counted 40 fewer than the notice',
  resource: 'delivery:ASN-1',
  baseRevisions: {},
  status: 'pending',
  requestedBy: 'local-user',
  createdAt: 0,
  expiresAt: 4_000_000_000_000,
};

async function workspace(stored?: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'receiving-migration-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const workspacePath = join(directory, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const folders = Object.fromEntries(
    Object.values(erpFolders).map((folder) => [folder, { path: join(directory, folder) }]),
  );
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' }, folders }),
  );
  if (stored) {
    const raw = new SQLiteStorage(join(workspacePath, 'workspace.sqlite'), () => stored);
    await raw.transact(LOCAL_WORKSPACE, async () => {});
    await raw.close();
  }
  const open = async () => {
    const instance = await openEmbeddedInstance(
      createReceivingApplication({ members: { viewer: 'viewer' } }),
      { workspacePath, settings: { 'site-policy': policy } },
    );
    cleanup.push(() => instance.close());
    return instance;
  };
  const snapshot = async () => {
    const raw = new SQLiteStorage<Record<string, unknown>>(
      join(workspacePath, 'workspace.sqlite'),
      () => ({}),
    );
    try {
      return await raw.read(LOCAL_WORKSPACE, async (stored) => structuredClone(stored));
    } finally {
      await raw.close();
    }
  };
  return { open, snapshot };
}

const list = async (
  instance: Awaited<ReturnType<typeof openEmbeddedInstance>>,
  context: ExecutionContext,
) =>
  (
    (await instance.application.queryRaw({ operation: 'approval.list', input: {} }, context))
      .data as { items: ApprovalRequest[] }
  ).items.map((item) => item.id);

describe('receiving state version 2', () => {
  test('approval requests stored at version 1 move into the approval feature once', async () => {
    const { open, snapshot } = await workspace({
      members: { 'local-user': 'editor', viewer: 'viewer' },
      sync: { erp: {} },
      deliveries: {},
      approvals: { a1: pending },
    });
    const first = await open();
    expect(await list(first, viewer)).toEqual(['a1']);
    await first.close();
    // Loading migrates in memory; the first commit stores the version 2 shape.
    const second = await open();
    expect(await list(second, viewer)).toEqual(['a1']);
    await second.application.invokeRaw(
      { operation: 'approval.reject', input: { id: 'a1', reason: 'Recounted' } },
      localUser,
    );
    await second.close();
    const stored = await snapshot();
    expect(stored.state).not.toHaveProperty('approvals');
    expect((stored.state as { approval: { requests: object } }).approval.requests).toEqual({
      a1: {
        ...pending,
        status: 'rejected',
        closedBy: 'local-user',
        closedAt: expect.any(Number),
        reason: 'Recounted',
      },
    });
    expect(stored.stateVersions).toMatchObject({
      application: { version: 2, readableFrom: 2 },
      'feature:approval': { version: 1, readableFrom: 1 },
    });
  });

  test('the ERP integration principal and non-members cannot list, request or decide', async () => {
    const { open } = await workspace();
    const instance = await open();
    const request = {
      operation: 'delivery.classify',
      input: { id: 'ASN-1', reason: 'short' },
      rationale: 'Short',
      resource: 'delivery:ASN-1',
      baseRevisions: {},
    };
    const { result } = await instance.application.invokeRaw(
      { operation: 'approval.request', input: request },
      localUser,
    );
    const id = (result as { id: string }).id;
    for (const caller of [erp, stranger]) {
      await expect(
        instance.application.queryRaw({ operation: 'approval.list', input: {} }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        instance.application.invokeRaw({ operation: 'approval.request', input: request }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        instance.application.invokeRaw({ operation: 'approval.approve', input: { id } }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        instance.application.queryRaw({ operation: 'reconciliation.list', input: {} }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      instance.application.invokeRaw({ operation: 'approval.reject', input: { id } }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await list(instance, viewer)).toEqual([id]);
  });
});
