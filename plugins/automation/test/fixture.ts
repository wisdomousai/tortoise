import { z } from 'zod';
import type { Harness } from '@agent-native/agents/types';
import {
  buildCatalog,
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  approvalOperations,
  type ApprovalRequest,
} from '@agent-native/contracts';
import { createMemoryEventLog } from '@agent-native/event-log';
import { defaultPorts } from '@agent-native/host';
import { createApplicationRuntime, defineApplication } from '@agent-native/host/application';
import { defineManifest } from '@agent-native/host/manifest';
import type { PluginStartContext } from '@agent-native/host/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import {
  createMemoryStorage,
  own,
  approvalHandlers,
  put,
  type AuthorizationPort,
  type ExecutionContext,
  type HandlerContext,
} from '@agent-native/runtime';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { defineTrigger, type TriggerDefinition } from '../contracts';
import type { Job } from '../jobs';
import { passOnce, type Loop } from '../loop';
import { createAutomationPlugin, type AutomationOptions } from '../plugin';
import { automationPluginManifest } from '../plugin-manifest';
import { createTriggerRuns } from '../run';
import { resolveTriggers } from '../triggers';

// A fixture application: lots anyone may receive and only inspectors may inspect.
const lotId = z.strictObject({ id: z.string() });
const fixture = { ui: { exception: 'test fixture' } } as const;
export const lotReceive = defineCapability({
  id: 'lot.receive',
  kind: 'command',
  input: jsonSchema(lotId),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Lot' },
  ...fixture,
});
export const lotInspect = defineCapability({ ...lotReceive, id: 'lot.inspect' });
const lotGet = defineCapability({
  id: 'lot.get',
  kind: 'query',
  input: jsonSchema(lotId),
  output: jsonSchema(z.strictObject({ id: z.string(), inspections: z.number() })),
  permission: { action: 'read', resourceType: 'Lot' },
  ...fixture,
});
const roleSet = defineCapability({
  id: 'role.set',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ principalId: z.string(), role: z.enum(['inspector', 'viewer']) }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'manage', resourceType: 'Role' },
  ...fixture,
});
// An agent that reads a received lot and must keep its model on this host.
const lotChecker = defineAgent({
  id: 'lot.checker',
  title: 'Lot checker',
  instructions: 'Read the received lot.',
  operations: ['lot.get'],
  model: 'local',
  output: 'direct',
  budgets: { turns: 2, toolCalls: 2, wallTimeMs: 10_000 },
});
// An agent on a local model that reads a received lot and requests approval for its inspection.
const lotReviewer = defineAgent({
  id: 'lot.reviewer',
  title: 'Lot reviewer',
  instructions:
    'Read the received lot with lot.get, then request approval for lot.inspect for it. Both take the lot’s own id, which is the part after `lot:` in its resource: `l1` for `lot:l1`.',
  operations: ['lot.get', 'lot.inspect'],
  model: 'local',
  output: 'request-approval',
  // Long enough for a real local model that reasons before each call (test/live.test.ts).
  budgets: { turns: 4, toolCalls: 4, wallTimeMs: 180_000 },
});
const lotsModule = defineModule({
  id: 'lots',
  capabilities: [lotReceive, lotInspect, lotGet, roleSet, ...Object.values(approvalOperations)],
  agents: [lotChecker, lotReviewer],
});

interface Lots {
  roles: Record<string, 'inspector' | 'viewer'>;
  lots: Record<string, { id: string; inspections: number }>;
  approvals: Record<string, ApprovalRequest>;
}
type Ctx = HandlerContext<{ lots: Lots }, unknown>;
const handlers = [
  {
    capability: lotReceive,
    handle(input: { id: string }, ctx: Ctx) {
      put(ctx.state.lots.lots, input.id, { id: input.id, inspections: 0 });
      ctx.change(`lot:${input.id}`, 'created');
      return {};
    },
  },
  {
    capability: lotInspect,
    handle(input: { id: string }, ctx: Ctx) {
      own(ctx.state.lots.lots, input.id)!.inspections++;
      ctx.change(`lot:${input.id}`);
      return {};
    },
  },
  {
    capability: lotGet,
    handle: (input: { id: string }, ctx: Ctx) => own(ctx.state.lots.lots, input.id)!,
  },
  {
    capability: roleSet,
    handle(input: { principalId: string; role: 'inspector' | 'viewer' }, ctx: Ctx) {
      ctx.state.lots.roles[input.principalId] = input.role;
      ctx.change(`role:${input.principalId}`);
      return {};
    },
  },
  ...approvalHandlers<{ lots: Lots }, unknown>({
    store: (state) => state.lots.approvals,
    commands: [lotReceive, lotInspect],
    visible: () => true,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  }),
];
// Inspecting needs the inspector role in the current state; everything else is open.
const policy: AuthorizationPort<{ lots: Lots }> = {
  authorize: ({ capability, context, state }) => ({
    allowed:
      capability.id !== lotInspect.id || state.lots.roles[context.principalId] === 'inspector',
  }),
  canReadEvent: () => true,
};

export const inspectOnReceive = defineTrigger({
  id: 'inspect-on-receive',
  title: 'Inspect received lots',
  on: { event: { resourceType: 'lot', operations: ['lot.receive'], types: ['created'] } },
  run: { job: 'inspect', operations: ['lot.inspect', 'lot.get'] },
});
export const everyMinute = defineTrigger({
  id: 'every-minute',
  title: 'Inspect the reference lot',
  on: { schedule: { everyMs: 60_000 } },
  run: { job: 'reference', operations: ['lot.inspect'] },
  budgets: { toolCalls: 1, wallTimeMs: 10_000 },
});
export const checkOnReceive = defineTrigger({
  id: 'check-on-receive',
  title: 'Check received lots',
  on: { event: { resourceType: 'lot', operations: ['lot.receive'] } },
  run: { agent: 'lot.checker' },
});
export const reviewOnReceive = defineTrigger({
  id: 'review-on-receive',
  title: 'Review received lots',
  prompt: 'A lot was received. Read it and request approval for its inspection.',
  on: { event: { resourceType: 'lot', operations: ['lot.receive'], types: ['created'] } },
  run: { agent: 'lot.reviewer' },
});
export const defaultJobs: Record<string, Job> = {
  inspect: async ({ event, command }) =>
    void (await command('lot.inspect', { id: event!.resource.slice(4) })),
  reference: async ({ command }) => void (await command('lot.inspect', { id: 'l0' })),
};

export const person = (principalId: string): ExecutionContext => ({
  workspaceId: 'local',
  principalId,
});

/** The lots application with the automation plugin. */
export function lotsApplication(
  options: {
    triggers?: readonly TriggerDefinition[];
    jobs?: Record<string, Job>;
    now?: () => number;
    intervalMs?: number;
    localModel?: AutomationOptions['localModel'];
    agentHarnesses?: readonly Harness[];
    /** Compose the site and network plugins, so the site policy binds `local-inference`. */
    network?: boolean;
  } = {},
) {
  let ids = 0;
  const triggers = options.triggers ?? [inspectOnReceive, everyMinute];
  const jobs = options.jobs ?? defaultJobs;
  const now = options.now ?? Date.now;
  const plugin = createAutomationPlugin({
    triggers,
    jobs,
    now,
    newId: () => `id${++ids}`,
    intervalMs: options.intervalMs ?? 10,
    ...(options.localModel ? { localModel: options.localModel } : {}),
    ...(options.agentHarnesses ? { agentHarnesses: options.agentHarnesses } : {}),
  });
  const definition = defineApplication<{ lots: Lots }>({
    manifest: defineManifest({
      id: 'lots',
      title: 'Lots',
      modules: [lotsModule],
      plugins: options.network
        ? [sitePluginManifest, networkPluginManifest, automationPluginManifest]
        : [automationPluginManifest],
    }),
    createState: () => ({
      lots: {
        roles: { ann: 'inspector', vic: 'viewer' },
        lots: { l0: { id: 'l0', inspections: 0 } },
        approvals: {},
      },
    }),
    handlers: handlers as never,
    authorization: policy,
    plugins: options.network ? [sitePlugin, networkPlugin, plugin] : [plugin],
  });
  return {
    definition,
    triggers,
    jobs: new Map(Object.entries(jobs)),
    now,
    newId: () => `id${++ids}`,
  };
}

/** The application in process with a trigger loop driven one pass at a time. */
export function inProcess(
  options: {
    triggers?: readonly TriggerDefinition[];
    jobs?: Record<string, Job>;
    agentHarnesses?: readonly Harness[];
  } = {},
) {
  let clock = 1_000_000;
  const now = () => clock;
  const { definition, triggers, jobs, newId } = lotsApplication({ ...options, now });
  const catalog = buildCatalog(definition.manifest.modules);
  const resolved = resolveTriggers(triggers, catalog, jobs);
  const log = createMemoryEventLog();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('owner')),
    services: { automation: { triggers: resolved, now, newId } },
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
  /** A fresh loop, as after a restart: a new run supervisor and no in-memory cursors. */
  const loop = (wrap?: (run: Loop['run']) => Loop['run']): Loop => {
    const run = createTriggerRuns(
      application,
      jobs,
      options.agentHarnesses ?? [],
      resolved.values(),
    );
    return {
      context,
      catalog,
      triggers: resolved,
      run: wrap ? wrap(run) : run,
      now,
      cursors: new Map(),
    };
  };
  const command = (operation: string, input: unknown, as: ExecutionContext) =>
    application.invokeRaw({ operation, input, idempotencyKey: crypto.randomUUID() }, as);
  const query = async (operation: string, input: unknown, as = person('ann')): Promise<any> =>
    (await application.queryRaw({ operation, input }, as)).data;
  const inspections = async (id: string) => (await query('lot.get', { id })).inspections;
  return {
    application,
    log,
    errors,
    loop,
    pass: (current: Loop) => passOnce(current),
    command,
    query,
    inspections,
    advance: (ms: number) => (clock += ms),
  };
}
