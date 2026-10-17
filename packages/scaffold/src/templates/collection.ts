import type { AppNames } from './application';
import { plural, type Names } from './names';

/** New files and the marker insertions into existing ones that one generated part needs. */
export interface Generated {
  readonly files: Readonly<Record<string, string>>;
  /** Path → marker → lines inserted before it. */
  readonly insertions: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

const contract = (one: Names, many: Names) => `import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** What a caller sees of one ${one.words}. */
export const ${one.camel}Schema = z.strictObject({
  id: recordKeySchema,
  title: z.string().min(1).max(200),
  status: z.enum(['open', 'done']),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type ${one.pascal} = z.output<typeof ${one.camel}Schema>;

export const ${many.camel} = defineCollection({
  type: '${one.kebab}',
  resourceType: '${one.pascal}',
  item: ${one.camel}Schema,
  label: { one: '${one.title}', many: '${many.title}' },
});

const write = { action: 'write', resourceType: '${one.pascal}' };

/** Reads and writes of ${many.words}. Browser-safe. */
export const ${one.camel}Operations = {
  ${one.camel}List: collectionList(${many.camel}, {
    id: '${one.kebab}',
    description: 'List ${many.words}, newest first. Filter by status or search the title.',
    filters: ['status'],
    search: true,
  }),
  ${one.camel}Get: collectionGet(${many.camel}, {
    id: '${one.kebab}',
    description: 'Read one ${one.words} by id. Use its revision as ${one.kebab}:<id> in expectedRevisions.',
  }),
  ${one.camel}Create: defineCapability({
    id: '${one.kebab}.create',
    kind: 'command',
    description: 'Create an open ${one.words} with a title. Editors only.',
    input: jsonSchema(z.strictObject({ title: ${one.camel}Schema.shape.title })),
    output: jsonSchema(${one.camel}Schema),
    permission: write,
    dependencies: ['${one.kebab}'],
    ui: { binding: '${one.kebab}.create' },
  }),
  ${one.camel}Update: defineCapability({
    id: '${one.kebab}.update',
    kind: 'command',
    description: 'Change the title or status of a ${one.words}. Editors only.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        title: ${one.camel}Schema.shape.title.optional(),
        status: ${one.camel}Schema.shape.status.optional(),
      }),
    ),
    output: jsonSchema(${one.camel}Schema),
    permission: write,
    dependencies: ['${one.kebab}'],
    ui: { binding: '${one.kebab}.update' },
  }),
} as const;
`;

const handlers = (one: Names, many: Names) => `import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { ${many.camel}, type ${one.pascal} } from '../contracts/${one.kebab}';
import type { AppState } from '../domain';
import { compact, handler, newId, now, type Context, type Services } from './context';

type List = typeof operations.${one.camel}List;
type Get = typeof operations.${one.camel}Get;
/** Every member sees every ${one.words}; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.${many.camel};
const ${many.camel}Of = (ctx: Context) => records(ctx, ${many.camel}, ctx.state.${many.camel});

/** Generated reads, scoped before filters and counts, and the create and update commands. */
export function ${one.camel}Handlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, ${one.pascal}>(${many.camel}, operations.${one.camel}List, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => record.title,
    }),
    collectionGetHandler<AppState, Services, Get, ${one.pascal}>(${many.camel}, operations.${one.camel}Get, {
      store,
      visible,
    }),
    handler(operations.${one.camel}Create, (input, ctx) => {
      const id = newId(ctx);
      return ${many.camel}Of(ctx).insert(id, {
        id,
        title: input.title,
        status: 'open',
        createdBy: ctx.context.principalId,
        createdAt: now(ctx),
      });
    }),
    handler(operations.${one.camel}Update, (input, ctx) => {
      const { id, ...patch } = input;
      return ${many.camel}Of(ctx).update(id, compact(patch));
    }),
  ];
}
`;

const screen = (
  one: Names,
  many: Names,
) => `import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/** Default screens for ${many.words}; replace either route with a purpose-built screen. */
export const ${one.camel}Routes = [
  {
    path: '${many.kebab}',
    component: () => (
      <CollectionScreen
        title="${many.title}"
        list={operations.${one.camel}List}
        create={operations.${one.camel}Create}
        open={(row) => \`/${many.kebab}/\${String(row.id)}\`}
      />
    ),
  },
  {
    path: '${many.kebab}/$id',
    component: () => (
      <RecordScreen
        title="${one.title}"
        get={operations.${one.camel}Get}
        update={operations.${one.camel}Update}
      />
    ),
  },
];
`;

const test = (
  app: AppNames,
  one: Names,
  many: Names,
) => `import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedAuthority } from '@agent-native/host';
import { create${app.app.pascal}Application } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${one.kebab}-'));
  let ids = 0;
  const authority = await openEmbeddedAuthority(
    create${app.app.pascal}Application({
      members: { viewer: 'viewer' },
      services: { newId: () => \`${one.kebab}-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => authority.close());
  return authority.application;
}

test('editors create and update ${many.words}; members list, filter and search them', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: '${one.kebab}.create', input: { title: 'First' }, idempotencyKey: 'create-1' },
    owner,
  );
  expect(created.result).toMatchObject({ id: '${one.kebab}-1', title: 'First', status: 'open', createdBy: 'owner' });
  await app.invokeRaw(
    { operation: '${one.kebab}.update', input: { id: '${one.kebab}-1', status: 'done' }, idempotencyKey: 'update-1' },
    owner,
  );
  const done = await app.queryRaw({ operation: '${one.kebab}.list', input: { status: 'done' } }, viewer);
  expect(done.data).toMatchObject({ total: 1, items: [{ id: '${one.kebab}-1', status: 'done' }] });
  const found = await app.queryRaw({ operation: '${one.kebab}.list', input: { search: 'fir' } }, viewer);
  expect(found.data).toMatchObject({ total: 1 });
});

test('viewers cannot write, strangers cannot read, and a missing ${one.words} is NOT_FOUND', async () => {
  const app = await open();
  await expect(
    app.invokeRaw({ operation: '${one.kebab}.create', input: { title: 'X' }, idempotencyKey: 'viewer' }, viewer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: '${one.kebab}.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: '${one.kebab}.get', input: { id: 'missing' } }, owner),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
`;

/** A collection with generated get and list, create and update commands, screens and a test. */
export function collection(app: AppNames, one: Names): Generated {
  const many = plural(one);
  const ops = ['List', 'Get', 'Create', 'Update'].map((op) => `operations.${one.camel}${op}.id`);
  return {
    files: {
      [`contracts/${one.kebab}.ts`]: contract(one, many),
      [`handlers/${one.kebab}.ts`]: handlers(one, many),
      [`ui/${one.kebab}.tsx`]: screen(one, many),
      [`test/${one.kebab}.test.ts`]: test(app, one, many),
    },
    insertions: {
      'contracts.ts': {
        imports: [`import { ${one.camel}Operations } from './contracts/${one.kebab}';`],
        operations: [`...${one.camel}Operations,`],
      },
      'domain.ts': {
        imports: [`import type { ${one.pascal} } from './contracts/${one.kebab}';`],
        state: [`${many.camel}: Record<string, ${one.pascal}>;`],
        initial: [`${many.camel}: {},`],
      },
      'policy.ts': {
        rules: [
          `[${ops[0]}]: 'open',`,
          `[${ops[1]}]: 'open',`,
          `[${ops[2]}]: editor,`,
          `[${ops[3]}]: editor,`,
        ],
        events: [`'${one.kebab}': () => true,`],
      },
      'server.ts': {
        imports: [`import { ${one.camel}Handlers } from './handlers/${one.kebab}';`],
        handlers: [`...${one.camel}Handlers(),`],
      },
      'screens.tsx': {
        imports: [`import { ${one.camel}Routes } from './ui/${one.kebab}';`],
        routes: [`...${one.camel}Routes,`],
        navigation: [`{ to: '/${many.kebab}', label: '${many.title}', icon: List },`],
        'capability-screens': [`{ prefix: '${one.kebab}.', to: '/${many.kebab}' },`],
      },
    },
  };
}
