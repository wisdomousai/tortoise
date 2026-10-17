import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  type AnyCapability,
  type InputOf,
  type OutputOf,
  defineModule,
  jsonSchema,
  proposalOperations,
  type Proposal,
} from '@agent-native/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  proposalHandlers,
  records,
  type ExecutionContext,
  type HandlerContext,
  type HandlerContribution,
} from '../src/index';

type Role = 'operator' | 'viewer';
interface State {
  roles: Record<string, Role>;
  lots: Record<string, { id: string; status: 'held' | 'released' }>;
  proposals: Record<string, Proposal>;
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
    proposals: {},
  };
  const app = createApplication({
    modules: [
      defineModule({
        id: 'lots',
        capabilities: [release, touch, getLot, revoke, ...Object.values(proposalOperations)],
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
        'proposal.submit': 'open',
        // Any member at a screen may accept; the proposed command's own rule decides the rest.
        // A delegated run never accepts, even its own proposal.
        'proposal.accept': { container: site, person: true },
        'proposal.reject': { ...operatorOnly, person: true },
        'proposal.expire': 'open',
        'proposal.list': 'open',
        'proposal.get': 'open',
      },
      events: { lot: () => true, proposal: () => true, role: () => true },
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
      ...proposalHandlers<State, {}>({
        store: (state) => state.proposals,
        commands: [release, touch, revoke],
        visible: (_proposal, ctx) => ctx.state.roles[ctx.context.principalId] !== undefined,
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
  const proposal = async (id = 'p1') =>
    (await app.queryRaw({ operation: 'proposal.get', input: { id } }, vic)).data as Proposal;
  return { app, lot, proposal, advance: (ms: number) => (clock += ms) };
}

const ann: ExecutionContext = { workspaceId: 'w', principalId: 'ann' };
const vic: ExecutionContext = { workspaceId: 'w', principalId: 'vic' };
// An agent run on Ann's behalf whose grant can propose but not release.
const annAgent: ExecutionContext = {
  ...ann,
  runId: 'run-1',
  grant: { operations: ['proposal.submit', 'proposal.list'], principalId: 'ann', runId: 'run-1' },
};
let keys = 0;
const invoke = (
  app: ReturnType<typeof setup>['app'],
  operation: string,
  input: unknown,
  context: ExecutionContext,
  idempotencyKey = `k${++keys}`,
) => app.invokeRaw({ operation, input, idempotencyKey }, context);
const propose = (app: ReturnType<typeof setup>['app'], baseRevisions = { 'lot:l1': 0 }) =>
  invoke(
    app,
    'proposal.submit',
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

describe('proposals', () => {
  test('an agent proposes and a person accepts: the command runs as the accepter, once', async () => {
    const { app, lot, proposal } = setup();
    const submitted = await propose(app);
    expect(submitted.result).toMatchObject({
      id: 'p1',
      status: 'open',
      proposedBy: 'ann',
      runId: 'run-1',
      expiresAt: 11_000,
    });
    expect(await lot()).toBe('held');
    const accepted = await invoke(app, 'proposal.accept', { id: 'p1' }, ann, 'accept');
    expect(accepted.result).toEqual({ id: 'p1', status: 'accepted', operation: 'lot.release' });
    expect(accepted.continuation).toEqual({
      operation: 'lot.release',
      result: { id: 'l1', status: 'released' },
    });
    expect(Object.keys(accepted.revisions).sort()).toEqual(['lot:l1', 'proposal:p1']);
    const replayed = await invoke(app, 'proposal.accept', { id: 'p1' }, ann, 'accept');
    expect(replayed.continuation).toEqual(accepted.continuation);
    expect(replayed.cursor).toBe(accepted.cursor);
    expect(await proposal()).toMatchObject({ status: 'accepted', closedBy: 'ann' });
    expect(await lot()).toBe('released');
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  test('accepting never widens authority; a refusal leaves the proposal open', async () => {
    const { app, lot, proposal } = setup();
    await propose(app);
    // The agent's grant lacks accept and the command, and the policy refuses delegated accepts.
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, annAgent)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, vic)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Vic may accept proposals but not release lots, so the release itself is refused. The same
    // holds for Ann once she is demoted between the proposal and her acceptance.
    await invoke(app, 'role.revoke', { principalId: 'ann' }, vic);
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await lot()).toBe('held');
    expect((await proposal()).status).toBe('open');
  });

  test('a record changed since the proposer read it conflicts and the proposal stays open', async () => {
    const { app, lot, proposal } = setup();
    await propose(app);
    await invoke(app, 'lot.touch', { id: 'l1' }, vic);
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await lot()).toBe('held');
    expect((await proposal()).status).toBe('open');
    await invoke(app, 'proposal.reject', { id: 'p1', reason: 'Lot changed' }, ann);
    expect(await proposal()).toMatchObject({ status: 'rejected', reason: 'Lot changed' });
  });

  test('only open, proposable commands with valid input are accepted for submission', async () => {
    const { app } = setup();
    const submit = (operation: string, input: unknown) =>
      invoke(app, 'proposal.submit', { operation, input, rationale: 'x' }, annAgent);
    for (const [operation, input] of [
      ['lot.missing', { id: 'l1' }],
      ['lot.release', { id: 1 }],
      ['proposal.accept', { id: 'p1' }],
    ] as const)
      await expect(submit(operation, input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('a proposal expires: accepting conflicts and expire closes it only after its expiry', async () => {
    const { app, proposal, advance } = setup();
    await propose(app);
    await expect(invoke(app, 'proposal.expire', { id: 'p1' }, vic)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    advance(10_000);
    await expect(invoke(app, 'proposal.accept', { id: 'p1' }, ann)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await invoke(app, 'proposal.expire', { id: 'p1' }, vic);
    expect((await proposal()).status).toBe('expired');
  });

  test('a continued command cannot continue again', async () => {
    const { app } = setup();
    await expect(
      invoke(
        app,
        'proposal.submit',
        { operation: 'proposal.submit', input: {}, rationale: 'x' },
        annAgent,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  test('a resource-scoped run proposes for its records only, creating the proposal record', async () => {
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
        'proposal.submit',
        { operation: 'lot.release', input: { id: 'l1' }, rationale: 'Passed.', resource },
        context,
      );
    // The new proposal record is outside the resource list; `creates` admits it.
    await expect(submit('lot:l1', scoped())).rejects.toMatchObject({
      message: 'Delegation does not permit changed resource',
    });
    const { id } = (await submit('lot:l1', scoped(['proposal']))).result as { id: string };
    await expect(submit('lot:l2', scoped(['proposal']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Delegation does not permit the proposed resource',
    });
    // `creates` covers only records with no revision yet: an existing proposal stays out of reach.
    advance(20_000);
    const expiring = scoped(['proposal']);
    await expect(
      invoke(
        app,
        'proposal.expire',
        { id },
        { ...expiring, grant: { ...expiring.grant!, operations: ['proposal.expire'] } },
      ),
    ).rejects.toMatchObject({ message: 'Delegation does not permit changed resource' });
  });
});
