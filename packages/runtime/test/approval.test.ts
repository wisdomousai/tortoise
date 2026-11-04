import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  type AnyCapability,
  type InputOf,
  type OutputOf,
  defineModule,
  jsonSchema,
  approvalOperations,
  type ApprovalRequest,
} from '@tortoise/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  exportApprovalDataset,
  approvalHandlers,
  REDACTED,
  records,
  type ExecutionContext,
  type HandlerContext,
  type HandlerContribution,
} from '../src/index';

type Role = 'operator' | 'viewer';
interface State {
  roles: Record<string, Role>;
  lots: Record<string, { id: string; status: 'held' | 'released' }>;
  approvals: Record<string, ApprovalRequest>;
}
const lots = { type: 'lot', label: { one: 'Lot', many: 'Lots' } } as const;
const fixture = { ui: { exception: 'test fixture' } } as const;
const release = defineCapability({
  id: 'lot.release',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ id: z.string(), status: z.literal('released') })),
  permission: { action: 'release', resourceType: 'Lot' },
  ...fixture,
});
const touch = defineCapability({
  id: 'lot.touch',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Lot' },
  ...fixture,
});
const getLot = defineCapability({
  id: 'lot.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ id: z.string(), status: z.enum(['held', 'released']) })),
  permission: { action: 'read', resourceType: 'Lot' },
  ...fixture,
});
const revoke = defineCapability({
  id: 'role.revoke',
  kind: 'command',
  input: jsonSchema(z.strictObject({ principalId: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'manage', resourceType: 'Role' },
  ...fixture,
});
const site = () => 'site';
/** Pair a capability with its handler, keeping the capability's input and output types. */
const handler = <C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, ctx: HandlerContext<State, {}>) => OutputOf<C>,
): HandlerContribution<State, {}> =>
  ({ capability, handle }) as unknown as HandlerContribution<State, {}>;
const operatorOnly = { container: site, roles: ['operator'] as Role[] };

function setup() {
  let ids = 0;
  let clock = 1_000;
  const state: State = {
    roles: { ann: 'operator', vic: 'viewer' },
    lots: { l1: { id: 'l1', status: 'held' } },
    approvals: {},
  };
  const app = createApplication({
    modules: [
      defineModule({
        id: 'lots',
        capabilities: [release, touch, getLot, revoke, ...Object.values(approvalOperations)],
      }),
    ],
    storage: createMemoryStorage<State>(state),
    services: {},
    authorization: definePolicy<State, Role>({
      roleOf: (state, principalId) => state.roles[principalId],
      operations: {
        'lot.release': operatorOnly,
        'lot.touch': 'open',
        'lot.get': 'open',
        'role.revoke': 'open',
        'approval.request': 'open',
        // Any member at a screen may approve; the requested command's own rule decides the rest.
        // A delegated run never approves, even its own approval request.
        'approval.approve': { container: site, person: true },
        'approval.reject': { ...operatorOnly, person: true },
        'approval.expire': 'open',
        'approval.list': 'open',
        'approval.get': 'open',
      },
      events: { lot: () => true, approval: () => true, role: () => true },
    }),
    handlers: [
      handler(release, (input, ctx) => {
        records(ctx, lots, ctx.state.lots).update(input.id, { status: 'released' });
        return { id: input.id, status: 'released' as const };
      }),
      handler(touch, (input, ctx) => {
        records(ctx, lots, ctx.state.lots).touch(input.id);
        return {};
      }),
      handler(getLot, (input, ctx) => ctx.state.lots[input.id]!),
      handler(revoke, (input, ctx) => {
        ctx.state.roles[input.principalId] = 'viewer';
        ctx.change(`role:${input.principalId}`, 'authorization.changed');
        return {};
      }),
      ...approvalHandlers<State, {}>({
        store: (state) => state.approvals,
        commands: [release, touch, revoke],
        visible: (_approval, ctx) => ctx.state.roles[ctx.context.principalId] !== undefined,
        newId: () => `p${++ids}`,
        now: () => clock,
        ttlMs: 10_000,
      }),
    ],
  });
  const lot = async () =>
    (
      (await app.queryRaw({ operation: 'lot.get', input: { id: 'l1' } }, ann)).data as {
        status: string;
      }
    ).status;
  const approval = async (id = 'p1') =>
    (await app.queryRaw({ operation: 'approval.get', input: { id } }, vic)).data as ApprovalRequest;
  return { app, lot, approval, advance: (ms: number) => (clock += ms) };
}

const ann: ExecutionContext = { workspaceId: 'w', principalId: 'ann' };
const vic: ExecutionContext = { workspaceId: 'w', principalId: 'vic' };
// An agent run on Ann's behalf whose grant can request approval but not release.
const annAgent: ExecutionContext = {
  ...ann,
  runId: 'run-1',
  grant: { operations: ['approval.request', 'approval.list'], principalId: 'ann', runId: 'run-1' },
};
let keys = 0;
const invoke = (
  app: ReturnType<typeof setup>['app'],
  operation: string,
  input: unknown,
  context: ExecutionContext,
  idempotencyKey = `k${++keys}`,
) => app.invokeRaw({ operation, input, idempotencyKey }, context);
const requestApproval = (app: ReturnType<typeof setup>['app'], baseRevisions = { 'lot:l1': 0 }) =>
  invoke(
    app,
    'approval.request',
    {
      operation: 'lot.release',
      input: { id: 'l1' },
      rationale: 'All checks passed.',
      confidence: 0.9,
      model: 'fixture',
      resource: 'lot:l1',
      baseRevisions,
    },
    annAgent,
  );

describe('approvals', () => {
  test('an agent requests approval and a person approves: the command runs as the approver, once', async () => {
    const { app, lot, approval } = setup();
    const submitted = await requestApproval(app);
    expect(submitted.result).toMatchObject({
      id: 'p1',
      status: 'pending',
      requestedBy: 'ann',
      runId: 'run-1',
      expiresAt: 11_000,
    });
    expect(await lot()).toBe('held');
    const approved = await invoke(app, 'approval.approve', { id: 'p1' }, ann, 'approve');
    expect(approved.result).toEqual({ id: 'p1', status: 'approved', operation: 'lot.release' });
    expect(approved.continuation).toEqual({
      operation: 'lot.release',
      result: { id: 'l1', status: 'released' },
    });
    expect(Object.keys(approved.revisions).sort()).toEqual(['approval-request:p1', 'lot:l1']);
    const replayed = await invoke(app, 'approval.approve', { id: 'p1' }, ann, 'approve');
    expect(replayed.continuation).toEqual(approved.continuation);
    expect(replayed.cursor).toBe(approved.cursor);
    expect(await approval()).toMatchObject({ status: 'approved', closedBy: 'ann' });
    expect(await lot()).toBe('released');
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  test('approving never widens a grant; a refusal leaves the approval pending', async () => {
    const { app, lot, approval } = setup();
    await requestApproval(app);
    // The agent's grant lacks approve and the command, and the policy refuses delegated approves.
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, annAgent)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, vic)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Vic may approve approval requests but not release lots, so the release itself is refused. The same
    // holds for Ann once she is demoted between the approval request and her approval.
    await invoke(app, 'role.revoke', { principalId: 'ann' }, vic);
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await lot()).toBe('held');
    expect((await approval()).status).toBe('pending');
  });

  test('a record changed since the requester read it conflicts and the approval stays open', async () => {
    const { app, lot, approval } = setup();
    await requestApproval(app);
    await invoke(app, 'lot.touch', { id: 'l1' }, vic);
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await lot()).toBe('held');
    expect((await approval()).status).toBe('pending');
    await invoke(app, 'approval.reject', { id: 'p1', reason: 'Lot changed' }, ann);
    expect(await approval()).toMatchObject({ status: 'rejected', reason: 'Lot changed' });
  });

  test('approval can be requested only for known commands with valid input, and not for approval operations', async () => {
    const { app } = setup();
    const submit = (operation: string, input: unknown) =>
      invoke(app, 'approval.request', { operation, input, rationale: 'x' }, annAgent);
    for (const [operation, input] of [
      ['lot.missing', { id: 'l1' }],
      ['lot.release', { id: 1 }],
      ['approval.approve', { id: 'p1' }],
    ] as const)
      await expect(submit(operation, input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test("a requesting agent's run requests approval only for the commands its grant lists", async () => {
    const { app } = setup();
    const limited: ExecutionContext = {
      ...annAgent,
      grant: { ...annAgent.grant!, requests: ['lot.touch'] },
    };
    await expect(
      invoke(
        app,
        'approval.request',
        { operation: 'lot.release', input: { id: 'l1' }, rationale: 'x' },
        limited,
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Delegation does not permit requesting lot.release',
    });
    const allowed = await invoke(
      app,
      'approval.request',
      { operation: 'lot.touch', input: { id: 'l1' }, rationale: 'x' },
      limited,
    );
    expect(allowed.result).toMatchObject({ operation: 'lot.touch', status: 'pending' });
  });

  test('an approval expires: approving conflicts and expire closes it only after its expiry', async () => {
    const { app, approval, advance } = setup();
    await requestApproval(app);
    await expect(invoke(app, 'approval.expire', { id: 'p1' }, vic)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    advance(10_000);
    await expect(invoke(app, 'approval.approve', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await invoke(app, 'approval.expire', { id: 'p1' }, vic);
    expect((await approval()).status).toBe('expired');
  });

  test('a continued command cannot continue again', async () => {
    const { app } = setup();
    await expect(
      invoke(
        app,
        'approval.request',
        { operation: 'approval.request', input: {}, rationale: 'x' },
        annAgent,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  test('a resource-scoped run requests approval for its records only, creating the approval record', async () => {
    const { app, advance } = setup();
    const scoped = (creates?: string[]): ExecutionContext => ({
      ...annAgent,
      grant: {
        ...annAgent.grant!,
        resources: ['lot:l1'],
        ...(creates ? { creates } : {}),
      },
    });
    const submit = (resource: string, context: ExecutionContext) =>
      invoke(
        app,
        'approval.request',
        { operation: 'lot.release', input: { id: 'l1' }, rationale: 'Passed.', resource },
        context,
      );
    // The new approval request record is outside the resource list; `creates` admits it.
    await expect(submit('lot:l1', scoped())).rejects.toMatchObject({
      message: 'Delegation does not permit changed resource',
    });
    const { id } = (await submit('lot:l1', scoped(['approval-request']))).result as { id: string };
    await expect(submit('lot:l2', scoped(['approval-request']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Delegation does not permit the requested resource',
    });
    // `creates` covers only records with no revision yet: an existing approval request stays out of reach.
    advance(20_000);
    const expiring = scoped(['approval-request']);
    await expect(
      invoke(
        app,
        'approval.expire',
        { id },
        { ...expiring, grant: { ...expiring.grant!, operations: ['approval.expire'] } },
      ),
    ).rejects.toMatchObject({ message: 'Delegation does not permit changed resource' });
  });
});

describe('approval dataset', () => {
  test('exports decided approvals the caller may see, redacted before the digest', async () => {
    const { app } = setup();
    await requestApproval(app);
    await requestApproval(app);
    await requestApproval(app);
    await invoke(app, 'approval.approve', { id: 'p1' }, ann);
    await invoke(app, 'approval.reject', { id: 'p2', reason: 'Lot l1 failed retest' }, ann);
    const full = await exportApprovalDataset(app, ann);
    // The pending approval request p3 is undecided and left out.
    expect(full.rows.map((row) => [row.id, row.outcome, row.reason])).toEqual([
      ['p1', 'approved', undefined],
      ['p2', 'rejected', 'Lot l1 failed retest'],
    ]);
    expect(full).toMatchObject({ format: 'agent-native/approval-dataset@1', exportedBy: 'ann' });
    expect(full.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await exportApprovalDataset(app, ann)).digest).toBe(full.digest);

    const redacted = await exportApprovalDataset(app, ann, {
      redact: { fields: { 'lot.release': ['id'] }, rationale: true, reason: true },
    });
    expect(redacted.rows[1]).toMatchObject({
      input: { id: REDACTED },
      rationale: REDACTED,
      reason: REDACTED,
    });
    expect(JSON.stringify(redacted.rows)).not.toContain('retest');
    expect(redacted.digest).not.toBe(full.digest);

    // Someone who may not see the approval requests exports none of them.
    const stranger = { workspaceId: 'w', principalId: 'zed' };
    expect((await exportApprovalDataset(app, stranger)).rows).toEqual([]);
    expect((await exportApprovalDataset(app, ann, { operations: ['lot.touch'] })).rows).toEqual([]);
  });
});
