import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ApplicationError,
  approvalModule,
  defineCapability,
  defineModule,
  jsonSchema,
} from '@tortoise/contracts';
import {
  approvalFeature,
  createApplication,
  createMemoryStorage,
  definePolicy,
  featureHandlers,
  routeAuthorization,
  type ApprovalAccess,
  type ApprovalSlice,
  type ExecutionContext,
} from '../src/index';

const finish = defineCapability({
  id: 'item.finish',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'finish', resourceType: 'item' },
  ui: { exception: 'test fixture' },
});
const items = defineModule({ id: 'items', capabilities: [finish] });

type Role = 'editor' | 'viewer';
type Root = {
  members: Record<string, Role>;
  done: string[];
  approval: ApprovalSlice;
};

const editorOnly = {
  allow: ({ state, context }: { state: Root; context: ExecutionContext }) =>
    state.members[context.principalId] === 'editor',
};
const applicationPolicy = definePolicy<Root, Role>({
  caller: { allow: (state, context) => context.principalId in state.members },
  operations: { [finish.id]: editorOnly },
  events: { item: () => true },
});
/** Members only; `item:secret` is hidden from everyone; only editors reject. */
const access = (state: Root): ApprovalAccess => ({
  allows(context, action, resource) {
    const role = state.members[context.principalId];
    if (!role || resource === 'item:secret') return false;
    return action !== 'reject' || role === 'editor';
  },
});

function setup(request?: (operation: string, input: unknown) => void) {
  const feature = approvalFeature({ ttlMs: 1000 });
  const storage = createMemoryStorage<Root>({
    members: { ann: 'editor', vic: 'viewer' },
    done: [],
    approval: { requests: {} },
  });
  let id = 0;
  const app = createApplication({
    modules: [items, approvalModule],
    storage,
    services: {},
    authorization: routeAuthorization<Root>(applicationPolicy, [
      {
        id: 'approval',
        operations: feature.manifest.modules.flatMap((m) => m.capabilities.map((c) => c.id)),
        resourceTypes: feature.authorization!.resourceTypes,
        select: (state) => state.approval,
        access,
        port: feature.authorization!.port,
      },
    ]),
    handlers: [
      {
        capability: finish,
        handle: (input: { id: string }, ctx) => {
          ctx.state.done.push(input.id);
          ctx.change(`item:${input.id}`);
          return {};
        },
      },
      ...featureHandlers<Root, {}>(
        {
          key: 'approval',
          feature,
          access,
          hooks: {
            newId: (() => `r${++id}`) as never,
            now: (() => 0) as never,
            ...(request ? { request: request as never } : {}),
          },
        },
        { modules: [items, ...feature.manifest.modules], applicationModules: [items] },
      ),
    ],
  });
  const state = () => storage.read('w', async (snapshot) => snapshot.state);
  return { app, state };
}

const person = (principalId: string): ExecutionContext => ({ workspaceId: 'w', principalId });
const run: ExecutionContext = {
  ...person('ann'),
  runId: 'run-1',
  grant: { operations: ['approval.request', 'approval.approve', 'item.finish'] },
};
const request = (resource = 'item:a') => ({
  operation: 'approval.request' as const,
  input: {
    operation: finish.id,
    input: { id: 'a' },
    rationale: 'Finished on the line',
    resource,
    baseRevisions: {},
  },
});

describe('approval feature', () => {
  test('a run requests, a person approves, and the command commits with the approval', async () => {
    const { app, state } = setup();
    const requested = await app.invoke(request(), run);
    expect(requested.result).toMatchObject({ id: 'r1', status: 'pending', requestedBy: 'ann' });
    await expect(
      app.invoke({ operation: 'approval.approve', input: { id: 'r1' } }, run),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await app.invoke({ operation: 'approval.approve', input: { id: 'r1' } }, person('ann'));
    const after = await state();
    expect(after.done).toEqual(['a']);
    expect(after.approval.requests.r1).toMatchObject({ status: 'approved', closedBy: 'ann' });
  });

  test("a viewer's approval is refused by the command's own rule and leaves the request pending", async () => {
    const { app, state } = setup();
    await app.invoke(request(), person('ann'));
    await expect(
      app.invoke({ operation: 'approval.approve', input: { id: 'r1' } }, person('vic')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invoke({ operation: 'approval.reject', input: { id: 'r1' } }, person('vic')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await state()).approval.requests.r1?.status).toBe('pending');
  });

  test('a non-member cannot request, list or approve, and a hidden request reads as missing', async () => {
    const { app } = setup();
    await app.invoke(request(), person('ann'));
    const outsider = person('erp-integration');
    await expect(app.invoke(request(), outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.query({ operation: 'approval.list', input: {} }, outsider),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invoke({ operation: 'approval.approve', input: { id: 'r1' } }, outsider),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.invoke(request('item:secret'), person('ann'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test("the application's request hook refuses an approval request before anyone sees it", async () => {
    const checked: unknown[] = [];
    const { app, state } = setup((operation, input) => {
      checked.push([operation, input]);
      if ((input as { id: string }).id !== 'a')
        throw new ApplicationError('INVALID_INPUT', 'No such item');
    });
    const unknown = { ...request(), input: { ...request().input, input: { id: 'zz' } } };
    await expect(app.invoke(unknown, person('ann'))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await app.invoke(request(), person('ann'));
    expect(checked).toEqual([
      [finish.id, { id: 'zz' }],
      [finish.id, { id: 'a' }],
    ]);
    expect(Object.keys((await state()).approval.requests)).toEqual(['r1']);
  });

  test('only visible requests are listed, and their events reach only members', async () => {
    const { app } = setup();
    await app.invoke(request(), person('ann'));
    const listed = await app.query({ operation: 'approval.list', input: {} }, person('vic'));
    expect((listed.data as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
      'r1',
    ]);
    const seen = async (context: ExecutionContext) =>
      (await app.events(0, context)).events.map((event) => event.resource);
    expect(await seen(person('vic'))).toEqual(['approval-request:r1']);
    expect(await seen(person('erp-integration'))).toEqual([]);
  });
});
