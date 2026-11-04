import type { AppNames } from './application';
import { plural, type Names } from './names';

/** New files and the marker insertions into existing ones that one generated part needs. */
export interface Generated {
  readonly files: Readonly<Record<string, string>>;
  /** Path → marker → lines inserted before it. */
  readonly insertions: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

/** Lines that only a tree collection gets, joined so the flat template keeps no blank lines. */
const only = (tree: boolean, ...lines: string[]) => (tree ? lines.join('\n') + '\n' : '');

const contract = (one: Names, many: Names, tree: boolean) => `import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
${only(tree, '  collectionMove,', '  collectionRetire,', '  collectionTree,')}  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';

/** What a caller sees of one ${one.words}. */
export const ${one.camel}Schema = z.strictObject({
  id: recordKeySchema,
  title: z.string().min(1).max(200),
  status: z.enum(['open', 'done']),
${only(tree, '  parentId: recordKeySchema.optional(),', '  retired: z.boolean(),')}  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type ${one.pascal} = z.output<typeof ${one.camel}Schema>;

export const ${many.camel} = defineCollection({
  type: '${one.kebab}',
  resourceType: '${one.pascal}',
  item: ${one.camel}Schema,
  label: { one: '${one.title}', many: '${many.title}' },
  titleField: 'title',
${only(tree, "  parent: 'parentId',", "  retiredField: 'retired',")}});

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
    description: 'Read one ${one.words} by id. A command receipt that changed it carries its revision as ${one.kebab}:<id> for expectedRevisions.',
  }),
${only(
  tree,
  `  ${one.camel}Tree: collectionTree(${many.camel}, {`,
  `    id: '${one.kebab}',`,
  `    description: 'The active ${many.words} depth first from root (or every root), each with its depth.',`,
  `  }),`,
)}  ${one.camel}Create: collectionCreate(${many.camel}, {
    id: '${one.kebab}',
    description: ${tree ? `'Create an open ${one.words} with a title, under parentId or as a root. Editors only.'` : `'Create an open ${one.words} with a title. Editors only.'`},
    fields: ${tree ? "['title', 'parentId']" : "['title']"},
  }),
  ${one.camel}Update: collectionUpdate(${many.camel}, {
    id: '${one.kebab}',
    description: 'Change the title or status of ${one.a}. Editors only.',
    fields: ['title', 'status'],
  }),
${only(
  tree,
  `  ${one.camel}Move: collectionMove(${many.camel}, {`,
  `    id: '${one.kebab}',`,
  `    description: 'Move ${one.a} and its subtree under another ${one.words}, or to the root with parentId null. Editors only.',`,
  `  }),`,
  `  ${one.camel}Retire: collectionRetire(${many.camel}, {`,
  `    id: '${one.kebab}',`,
  `    description: 'Retire ${one.a}; its children must be retired or moved first. Editors only.',`,
  `  }),`,
)}} as const;
`;

const handlers = (one: Names, many: Names, tree: boolean) => `import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
${only(tree, '  collectionTreeHandler,')}  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { ${many.camel}, type ${one.pascal} } from '../contracts/${one.kebab}';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

type List = typeof operations.${one.camel}List;
type Get = typeof operations.${one.camel}Get;
${only(tree, `type Tree = typeof operations.${one.camel}Tree;`)}/** Every member sees every ${one.words}; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.${many.camel};

/** Generated reads, scoped before filters and counts, and the generated commands. */
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
${only(
  tree,
  `    collectionTreeHandler<AppState, Services, Tree, ${one.pascal}>(${many.camel}, operations.${one.camel}Tree, {`,
  `      store,`,
  `      visible,`,
  `      order: (a, b) => a.title.localeCompare(b.title),`,
  `    }),`,
)}    ...collectionCommandHandlers<AppState, Services, ${one.pascal}>(
      ${many.camel},
      {
        create: operations.${one.camel}Create,
        update: operations.${one.camel}Update,
${only(tree, `        move: operations.${one.camel}Move,`, `        retire: operations.${one.camel}Retire,`)}      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: a new ${one.words} is open and records who made it.
        defaults: (ctx) => ({
          status: 'open',
${only(tree, '          retired: false,')}          createdBy: ctx.context.principalId,
          createdAt: now(ctx),
        }),
      },
    ),
  ];
}
`;

const flatScreen = (
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

const treeScreen = (
  one: Names,
  many: Names,
) => `import { RecordScreen } from '@/components/collection-screen';
import { CollectionTree } from '@/components/collection-tree';
import { operations } from '../contracts';

/** Default screens for ${many.words}; replace either route with a purpose-built screen. */
export const ${one.camel}Routes = [
  {
    path: '${many.kebab}',
    component: () => (
      <CollectionTree
        title="${many.title}"
        tree={operations.${one.camel}Tree}
        search={operations.${one.camel}List}
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
        move={operations.${one.camel}Move}
        retire={operations.${one.camel}Retire}
      />
    ),
  },
];
`;

const treeTest = (one: Names, many: Names) => `
test('${many.words} form a tree: moves refuse cycles, and retiring needs the children gone', async () => {
  const app = await open();
  const create = (title: string, parentId: string | undefined, key: string) =>
    app.invokeRaw(
      { operation: '${one.kebab}.create', input: { title, ...(parentId ? { parentId } : {}) }, idempotencyKey: key },
      owner,
    );
  await create('Root', undefined, 'root');
  await create('Child', '${one.kebab}-1', 'child');
  const tree = await app.queryRaw({ operation: '${one.kebab}.tree', input: {} }, viewer);
  expect(tree.data).toMatchObject({ total: 2, items: [{ title: 'Root', depth: 0 }, { title: 'Child', depth: 1 }] });
  await expect(
    app.invokeRaw({ operation: '${one.kebab}.move', input: { id: '${one.kebab}-1', parentId: '${one.kebab}-2' }, idempotencyKey: 'cycle' }, owner),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    app.invokeRaw({ operation: '${one.kebab}.retire', input: { id: '${one.kebab}-1' }, idempotencyKey: 'early' }, owner),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await app.invokeRaw({ operation: '${one.kebab}.retire', input: { id: '${one.kebab}-2' }, idempotencyKey: 'leaf' }, owner);
  const active = await app.queryRaw({ operation: '${one.kebab}.tree', input: {} }, viewer);
  expect(active.data).toMatchObject({ total: 1 });
});
`;

const test = (
  app: AppNames,
  one: Names,
  many: Names,
  tree: boolean,
) => `import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
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
  const instance = await openEmbeddedInstance(
    create${app.app.pascal}Application({
      members: { viewer: 'viewer' },
      services: { newId: () => \`${one.kebab}-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
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
${tree ? treeTest(one, many) : ''}`;

/**
 * A collection with generated get and list, create and update commands, screens and a test. A
 * `tree` collection also gets a parent, move, retire and a tree read, and a tree screen.
 */
export function collection(app: AppNames, one: Names, tree = false): Generated {
  const many = plural(one);
  const reads = tree ? ['List', 'Get', 'Tree'] : ['List', 'Get'];
  const writes = tree ? ['Create', 'Update', 'Move', 'Retire'] : ['Create', 'Update'];
  const id = (op: string) => `operations.${one.camel}${op}.id`;
  return {
    files: {
      [`contracts/${one.kebab}.ts`]: contract(one, many, tree),
      [`handlers/${one.kebab}.ts`]: handlers(one, many, tree),
      [`ui/${one.kebab}.tsx`]: tree ? treeScreen(one, many) : flatScreen(one, many),
      [`test/${one.kebab}.test.ts`]: test(app, one, many, tree),
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
          ...reads.map((op) => `[${id(op)}]: 'open',`),
          ...writes.map((op) => `[${id(op)}]: editor,`),
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
