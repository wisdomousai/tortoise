import type { AppNames } from './application';
import type { Generated } from './collection';
import type { Names } from './names';

const contracts = (id: Names, screens: boolean) => {
  const ui = (operation: string) =>
    screens
      ? `{ binding: '${id.kebab}.${operation}' }`
      : `{ exception: 'headless until a screen binds it' }`;
  return `import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** One entry of the ${id.words} feature. */
export const ${id.camel}EntrySchema = z.strictObject({
  id: recordKeySchema,
  text: z.string().min(1).max(500),
  recordedBy: z.string(),
  recordedAt: z.number().int().nonnegative(),
});
export type ${id.pascal}Entry = z.output<typeof ${id.camel}EntrySchema>;

/** The ${id.words} feature's operations. Browser-safe; every ID starts with \`${id.kebab}.\`. */
export const ${id.camel}Operations = {
  ${id.camel}List: defineCapability({
    id: '${id.kebab}.list',
    kind: 'query',
    description: 'List ${id.words} entries, newest first.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(${id.camel}EntrySchema) })),
    permission: { action: 'read', resourceType: '${id.kebab}' },
    ui: ${ui('list')},
  }),
  ${id.camel}Record: defineCapability({
    id: '${id.kebab}.record',
    kind: 'command',
    description: 'Record one ${id.words} entry with a short text. People only; an agent run is refused.',
    input: jsonSchema(z.strictObject({ text: ${id.camel}EntrySchema.shape.text })),
    output: jsonSchema(${id.camel}EntrySchema),
    permission: { action: 'record', resourceType: '${id.kebab}' },
    ui: ${ui('record')},
  }),
} as const;

/** The browser-safe part the application lists in \`defineManifest({ features })\`. */
export const ${id.camel}FeatureManifest = defineFeatureManifest({
  id: '${id.kebab}',
  title: '${id.title}',
  modules: [defineModule({ id: '${id.kebab}', capabilities: Object.values(${id.camel}Operations) })],
});
`;
};

const feature = (id: Names) => `import { defineFeature } from '@agent-native/host/feature';
import {
  isDelegated,
  own,
  put,
  type ExecutionContext,
  type FeatureHandler,
  type FeaturePolicy,
} from '@agent-native/runtime';
import { ${id.camel}FeatureManifest, ${id.camel}Operations, type ${id.pascal}Entry } from './contracts';

/** What a caller does in the ${id.words} feature. */
export type ${id.pascal}Action = 'read' | 'record';

/**
 * The application's decision on who may do what. The application's policy never sees this
 * feature's operations, so \`allows\` applies its membership gate and integration allowlists itself.
 */
export interface ${id.pascal}Access {
  allows(context: ExecutionContext, action: ${id.pascal}Action): boolean;
}

/** Application code the feature calls; each defaults when the application omits it. */
export interface ${id.pascal}Hooks {
  newId?(): string;
  now?(): number;
}

/** The feature's state slice, under \`${id.kebab}\` in the application's state. */
export interface ${id.pascal}Slice {
  readonly entries: Record<string, ${id.pascal}Entry>;
}

const ops = ${id.camel}Operations;
const actionOf = (operation: string): ${id.pascal}Action =>
  operation === ops.${id.camel}Record.id ? 'record' : 'read';

/**
 * Reads need \`read\` and recording needs \`record\`, under the access view of the state being
 * committed and of the previous state. Recording is person-only for every application.
 */
const policy: FeaturePolicy<${id.pascal}Slice, ${id.pascal}Access> = {
  authorize({ capability, context, access, previousAccess }) {
    if (capability.id === ops.${id.camel}Record.id && isDelegated(context))
      return { allowed: false, reason: 'PERSON_ONLY' };
    const action = actionOf(capability.id);
    const allowed =
      access.allows(context, action) && (!previousAccess || previousAccess.allows(context, action));
    return allowed ? { allowed: true } : { allowed: false, reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ event, state, context, access }) =>
    !!own(state.entries, event.resource.slice('${id.kebab}:'.length)) &&
    access.allows(context, 'read'),
};

type Handler<C extends (typeof ops)[keyof typeof ops]> = FeatureHandler<
  ${id.pascal}Slice,
  unknown,
  ${id.pascal}Access,
  ${id.pascal}Hooks,
  C
>;
const list: Handler<typeof ops.${id.camel}List> = {
  capability: ops.${id.camel}List,
  handle: (_input, ctx) => ({
    items: Object.values(ctx.state.entries).sort(
      (a, b) => b.recordedAt - a.recordedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  }),
};
const record: Handler<typeof ops.${id.camel}Record> = {
  capability: ops.${id.camel}Record,
  handle: (input, ctx) => {
    const id = ctx.hooks.newId?.() ?? crypto.randomUUID();
    const entry = {
      id,
      text: input.text,
      recordedBy: ctx.context.principalId,
      recordedAt: ctx.hooks.now?.() ?? Date.now(),
    };
    put(ctx.state.entries, id, entry);
    ctx.change(\`${id.kebab}:\${id}\`);
    return entry;
  },
};

/**
 * The ${id.words} feature: entries in the \`${id.kebab}\` slice. Mount it with
 * \`mountFeature(${id.camel}Feature(), { access, hooks })\`; add a slice migration whenever the
 * entry shape changes.
 */
export function ${id.camel}Feature() {
  return defineFeature<${id.pascal}Slice, ${id.pascal}Access, ${id.pascal}Hooks>({
    manifest: ${id.camel}FeatureManifest,
    state: { create: () => ({ entries: {} }) },
    handlers: [list, record],
    authorization: { resourceTypes: ['${id.kebab}'], port: policy },
  });
}
`;

const screens = (id: Names) => `import { useState } from 'react';
import { List } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { defineFeatureScreens } from '@agent-native/frame/feature-screens';
import { client, live } from '@/lib/session';
import { ${id.camel}Operations } from './contracts';

/** The ${id.words} entries, newest first, and a field to record one. */
function ${id.pascal}Screen() {
  const entries = useQuery(live.liveQueryOptions(${id.camel}Operations.${id.camel}List, {}));
  const [text, setText] = useState('');
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">${id.title}</h1>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!text.trim()) return;
          await client.command(${id.camel}Operations.${id.camel}Record, { text: text.trim() });
          setText('');
        }}
      >
        <input
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          aria-label="Entry"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="h-9 rounded-md border px-3 text-sm" type="submit">
          Record
        </button>
      </form>
      <ul className="space-y-2 text-sm">
        {(entries.data?.items ?? []).map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
    </div>
  );
}

/** The ${id.words} feature's screens, added to \`defineScreens({ features })\`. */
export const ${id.camel}Screens = defineFeatureScreens({
  id: '${id.kebab}',
  routes: [{ path: '${id.kebab}', component: ${id.pascal}Screen }],
  navigation: [{ to: '/${id.kebab}', label: '${id.title}', icon: List }],
  capabilityScreens: [{ prefix: '${id.kebab}.', to: '/${id.kebab}' }],
});
`;

const test = (
  app: AppNames,
  id: Names,
) => `import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@agent-native/host';
import { featureConformance } from '@agent-native/testing/features';
import { create${app.app.pascal}Application } from '../application';
import { ${id.camel}Feature } from '../features/${id.kebab}/feature';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe('${id.kebab} feature conformance', () => {
  const entry = { id: 'e1', text: 'First', recordedBy: 'person', recordedAt: 0 };
  for (const check of featureConformance(${id.camel}Feature(), {
    allowAll: { allows: () => true },
    denyAll: { allows: () => false },
    sampleSlice: { entries: { e1: entry } },
    requests: [
      { operation: '${id.kebab}.list', input: {} },
      { operation: '${id.kebab}.record', input: { text: 'Second' } },
    ],
    events: [
      { cursor: 1, resource: '${id.kebab}:e1', revision: 1, type: 'changed', operation: '${id.kebab}.record' },
    ],
    personOnly: ['${id.kebab}.record'],
  }))
    test(check.name, check.run);
});

test('editors record ${id.words} entries, viewers read them and non-members reach neither', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${id.kebab}-'));
  const instance = await openEmbeddedInstance(
    create${app.app.pascal}Application({ members: { viewer: 'viewer' } }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const app = instance.application;
  const record = (text: string) => ({ operation: '${id.kebab}.record', input: { text }, idempotencyKey: text });
  await app.invokeRaw(record('First'), owner);
  await expect(app.invokeRaw(record('Second'), viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const listed = await app.queryRaw({ operation: '${id.kebab}.list', input: {} }, viewer);
  expect((listed.data as { items: { text: string }[] }).items.map((item) => item.text)).toEqual([
    'First',
  ]);
  await expect(
    app.queryRaw({ operation: '${id.kebab}.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
`;

/**
 * A feature the application mounts once: a manifest with a list query and a person-only record
 * command, the server part with its slice, handlers and policy over an access view, an access
 * view from the workspace roles in `policy.ts`, the mount in `application.ts`, a test with the
 * feature conformance cases and, with `screens`, a screen added through `defineScreens`.
 */
export function featurePart(app: AppNames, id: Names, withScreens: boolean): Generated {
  const base = `features/${id.kebab}`;
  const files: Record<string, string> = {
    [`${base}/contracts.ts`]: contracts(id, withScreens),
    [`${base}/feature.ts`]: feature(id),
    [`test/${id.kebab}-feature.test.ts`]: test(app, id),
  };
  if (withScreens) files[`${base}/screens.tsx`] = screens(id);
  const access = [
    `/** Who may do what in the ${id.words} feature: members read, editors record. */`,
    `export const ${id.camel}Access = (state: AppState): ${id.pascal}Access => ({`,
    '  allows(context, action) {',
    '    const role = roleOf(state, context.principalId);',
    "    return action === 'read' ? role !== undefined : role === 'editor';",
    '  },',
    '});',
  ];
  return {
    files,
    insertions: {
      'manifest.ts': {
        imports: [`import { ${id.camel}FeatureManifest } from './${base}/contracts';`],
        features: [`${id.camel}FeatureManifest,`],
      },
      'policy.ts': {
        imports: [`import type { ${id.pascal}Access } from './${base}/feature';`],
        access,
      },
      'application.ts': {
        imports: [
          `import { mountFeature } from '@agent-native/host/feature';`,
          `import { newId, now } from './handlers/context';`,
          `import { ${id.camel}Access } from './policy';`,
          `import { ${id.camel}Feature, type ${id.pascal}Access, type ${id.pascal}Hooks } from './${base}/feature';`,
        ],
        features: [
          `mountFeature<AppState, ${id.pascal}Access, ${id.pascal}Hooks, Services>(${id.camel}Feature(), {`,
          `  access: ${id.camel}Access,`,
          '  hooks: { newId: (ctx) => newId(ctx), now: (ctx) => now(ctx) },',
          '}),',
        ],
      },
      ...(withScreens
        ? {
            'screens.tsx': {
              imports: [`import { ${id.camel}Screens } from './${base}/screens';`],
              features: [`${id.camel}Screens,`],
            },
          }
        : {}),
    },
  };
}
