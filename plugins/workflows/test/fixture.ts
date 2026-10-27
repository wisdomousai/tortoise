import { z } from 'zod';
import {
  ApplicationError,
  buildCatalog,
  defineCapability,
  defineModule,
  defineWorkflow,
  from,
  jsonSchema,
  step,
} from '@agent-native/contracts';
import { createMemoryEventLog } from '@agent-native/event-log';
import { defaultPorts } from '@agent-native/host';
import { createApplicationRuntime, defineApplication } from '@agent-native/host/application';
import { defineManifest } from '@agent-native/host/manifest';
import type { PluginStartContext } from '@agent-native/host/plugin';
import {
  createMemoryStorage,
  own,
  put,
  type AuthorizationPort,
  type ExecutionContext,
  type HandlerContext,
} from '@agent-native/runtime';
import { workflowOperations } from '../contracts';
import { resolveWorkflows, type Definition } from '../definitions';
import { createWorkflowsPlugin } from '../plugin';
import { workflowsPluginManifest } from '../plugin-manifest';
import { passOnce, type Runner } from '../runner';

// A fixture application: parcels anyone reserves and only shippers ship through a carrier.
const fixture = { ui: { exception: 'test fixture' } } as const;
const parcelId = z.strictObject({ id: z.string() });
const parcelOutput = z.strictObject({ id: z.string(), status: z.string() });
const command = (id: string, input: z.ZodObject = parcelId, extra = {}) =>
  defineCapability({
    id,
    kind: 'command',
    input: jsonSchema(input),
    output: jsonSchema(parcelOutput),
    permission: { action: 'write', resourceType: 'Parcel' },
    ...fixture,
    ...extra,
  });
const parcel = {
  create: command('parcel.create'),
  reserve: command('parcel.reserve'),
  release: command('parcel.release'),
  ship: command('parcel.ship'),
  deliver: command('parcel.deliver'),
  confirm: command(
    'parcel.confirm',
    z.strictObject({ id: z.string(), ref: z.string().optional() }),
  ),
  flaky: command('parcel.flaky'),
  complete: command(
    'carrier.complete',
    z.strictObject({ id: z.string(), effect: z.string(), accepted: z.boolean() }),
  ),
  file: command('parcel.file', parcelId, { invokes: ['workflow.start'] }),
  get: defineCapability({
    id: 'parcel.get',
    kind: 'query',
    input: jsonSchema(parcelId),
    output: jsonSchema(
      z.strictObject({
        id: z.string(),
        status: z.string(),
        confirmations: z.number(),
        ref: z.string().optional(),
        /** Times it was reserved, so a replayed step shows as one call. */
        calls: z.number(),
      }),
    ),
    permission: { action: 'read', resourceType: 'Parcel' },
    ...fixture,
  }),
  role: command(
    'role.set',
    z.strictObject({ principalId: z.string(), role: z.enum(['shipper', 'viewer']) }),
  ),
};

export const shipParcel = defineWorkflow({
  id: 'ship-parcel',
  version: 1,
  text: 'Reserve a parcel, ship it through the carrier, wait for delivery and confirm it.',
  input: jsonSchema(parcelId),
  maxDurationMs: 86_400_000,
  start: 'parcel.file',
  steps: [
    step.run('reserve', 'parcel.reserve', {
      input: { id: from.input('id') },
      compensate: { command: 'parcel.release', input: { id: from.step('reserve', 'id') } },
    }),
    step.run('ship', 'parcel.ship', {
      input: { id: from.input('id') },
      await: 'effects',
      retry: { attempts: 3, backoffMs: 1_000 },
    }),
    step.wait('delivered', 'parcel.get', {
      input: { id: from.input('id') },
      watch: ['parcel'],
      until: { equals: [from.result('status'), 'delivered'] },
      timeoutMs: 3_600_000,
    }),
    step.run('confirm', 'parcel.confirm', {
      input: { id: from.input('id'), ref: from.effect('ship', 0, 'externalRef') },
    }),
  ],
});
export const flakyParcel = defineWorkflow({
  id: 'flaky-parcel',
  version: 1,
  text: 'Reserve a parcel, then call a step that fails while the fixture says so.',
  input: jsonSchema(parcelId),
  maxDurationMs: 86_400_000,
  steps: [
    step.run('reserve', 'parcel.reserve', {
      input: { id: from.input('id') },
      compensate: { command: 'parcel.release', input: { id: from.step('reserve', 'id') } },
    }),
    step.run('flaky', 'parcel.flaky', {
      input: { id: from.input('id') },
      retry: { attempts: 3, backoffMs: 1_000, on: ['INTERNAL'] },
    }),
  ],
});

/** Failures `parcel.flaky` throws before it succeeds, and the code it throws. */
export const flaky = { failures: 0, code: 'UNAVAILABLE' as 'UNAVAILABLE' | 'INVALID_INPUT' };

interface Parcels {
  roles: Record<string, 'shipper' | 'viewer'>;
  parcels: Record<
    string,
    { id: string; status: string; confirmations: number; ref?: string; calls: number }
  >;
}
type State = { parcels: Parcels };
type Ctx = HandlerContext<State, unknown>;
const view = (record: Parcels['parcels'][string]) => ({ id: record.id, status: record.status });
function set(ctx: Ctx, id: string, status: string) {
  const record = own(ctx.state.parcels.parcels, id);
  if (!record) throw new ApplicationError('NOT_FOUND', 'Parcel unavailable');
  record.status = status;
  ctx.change(`parcel:${id}`);
  return record;
}
const transition = (status: string) => (input: { id: string }, ctx: Ctx) =>
  view(set(ctx, input.id, status));

const handlers = [
  {
    capability: parcel.create,
    handle(input: { id: string }, ctx: Ctx) {
      const record = { id: input.id, status: 'new', confirmations: 0, calls: 0 };
      put(ctx.state.parcels.parcels, input.id, record);
      ctx.change(`parcel:${input.id}`, 'created');
      return view(record);
    },
  },
  {
    capability: parcel.reserve,
    handle(input: { id: string }, ctx: Ctx) {
      const record = set(ctx, input.id, 'reserved');
      record.calls++;
      return view(record);
    },
  },
  { capability: parcel.release, handle: transition('released') },
  { capability: parcel.deliver, handle: transition('delivered') },
  {
    capability: parcel.ship,
    handle(input: { id: string }, ctx: Ctx) {
      const record = set(ctx, input.id, 'shipped');
      ctx.enqueue({
        target: 'carrier',
        type: 'ship',
        payload: { id: input.id },
        resource: `parcel:${input.id}`,
      });
      return view(record);
    },
  },
  {
    capability: parcel.confirm,
    handle(input: { id: string; ref?: string }, ctx: Ctx) {
      const record = set(ctx, input.id, 'confirmed');
      record.confirmations++;
      if (input.ref) record.ref = input.ref;
      return view(record);
    },
  },
  {
    capability: parcel.flaky,
    handle(input: { id: string }, ctx: Ctx) {
      if (flaky.failures > 0) {
        flaky.failures--;
        throw new ApplicationError(flaky.code, 'The flaky step failed');
      }
      return view(set(ctx, input.id, 'flaked'));
    },
  },
  {
    capability: parcel.complete,
    handle(input: { id: string; effect: string; accepted: boolean }, ctx: Ctx) {
      ctx.completeEffect(
        input.effect,
        input.accepted
          ? { status: 'accepted', externalRef: `track-${input.id}` }
          : { status: 'rejected', code: 'REFUSED', message: 'The carrier refused the parcel' },
      );
      return view(set(ctx, input.id, input.accepted ? 'in-transit' : 'refused'));
    },
  },
  {
    capability: parcel.file,
    async handle(input: { id: string }, ctx: Ctx) {
      const instance = await ctx.invoke(workflowOperations.start, {
        workflow: shipParcel.id,
        input: { id: input.id },
        key: input.id,
      });
      return { id: instance.id, status: instance.status };
    },
  },
  {
    capability: parcel.get,
    handle: (input: { id: string }, ctx: Ctx) => own(ctx.state.parcels.parcels, input.id)!,
  },
  {
    capability: parcel.role,
    handle(input: { principalId: string; role: 'shipper' | 'viewer' }, ctx: Ctx) {
      ctx.state.parcels.roles[input.principalId] = input.role;
      ctx.change(`role:${input.principalId}`);
      return { id: input.principalId, status: input.role };
    },
  },
];
// Shipping needs the shipper role in the current state; everything else is open.
const policy: AuthorizationPort<State> = {
  authorize: ({ capability, context, state }) => ({
    allowed:
      capability.id !== parcel.ship.id || state.parcels.roles[context.principalId] === 'shipper',
  }),
  canReadEvent: () => true,
};

export const person = (principalId: string): ExecutionContext => ({
  workspaceId: 'local',
  principalId,
});

/** The parcels application with the workflows plugin. */
export function parcelsApplication(options: { now?: () => number; intervalMs?: number } = {}) {
  let ids = 0;
  const plugin = createWorkflowsPlugin({
    now: options.now ?? Date.now,
    newId: () => `w${++ids}`,
    intervalMs: options.intervalMs ?? 10,
  });
  return defineApplication<State>({
    manifest: defineManifest({
      id: 'parcels',
      title: 'Parcels',
      modules: [
        defineModule({
          id: 'parcel',
          capabilities: Object.values(parcel),
          workflows: [shipParcel, flakyParcel],
        }),
      ],
      plugins: [workflowsPluginManifest],
    }),
    createState: () => ({ parcels: { roles: { ann: 'shipper', vic: 'viewer' }, parcels: {} } }),
    handlers: handlers as never,
    authorization: policy,
    plugins: [plugin],
  });
}

/** The application in process, with the runner driven one pass at a time on a fake clock. */
export function inProcess() {
  let clock = 1_000_000;
  const now = () => clock;
  const definition = parcelsApplication({ now });
  const catalog = buildCatalog(definition.manifest.modules);
  const definitions = new Map<string, Definition>(
    resolveWorkflows(definition.manifest.modules, catalog),
  );
  let ids = 0;
  const log = createMemoryEventLog();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('owner')),
    services: { workflow: { definitions, now, newId: () => `w${++ids}` } },
    eventLog: log,
    now,
  });
  const errors: unknown[] = [];
  const context: PluginStartContext = {
    application,
    workspaceId: 'local',
    ports: defaultPorts,
    delegate: (grant) => ({
      workspaceId: 'local',
      principalId: 'owner',
      grant: { ...grant, principalId: 'owner', workspaceId: 'local' },
    }),
    onError: (_scope, error) => errors.push(error),
  };
  /** A fresh runner, as after a restart: no in-memory cursors. */
  const runner = (): Runner => ({ context, cursors: new Map() });
  const shared = runner();
  const invoke = (operation: string, input: unknown, as: ExecutionContext = person('ann')) =>
    application.invokeRaw({ operation, input, idempotencyKey: crypto.randomUUID() }, as);
  const query = async (operation: string, input: unknown, as = person('ann')): Promise<any> =>
    (await application.queryRaw({ operation, input }, as)).data;
  const instance = (id: string, as = person('ann')) => query('workflow.get', { id }, as);
  /** Pending effects, held ones included. */
  const pending = async () => application.pendingEffects(person('owner'), { includeHeld: true });
  return {
    application,
    definitions,
    log,
    errors,
    runner,
    pass: (current: Runner = shared) => passOnce(current),
    invoke,
    query,
    instance,
    pending,
    parcel: (id: string) => query('parcel.get', { id }),
    advance: (ms: number) => (clock += ms),
  };
}
