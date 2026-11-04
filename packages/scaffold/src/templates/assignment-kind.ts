import type { AppNames } from './application';
import type { Generated } from './collection';
import { plural, type Names } from './names';

const kindContract = (kind: Names, one: Names, many: Names) => `import { z } from 'zod';
import { recordKeySchema } from '@tortoise/contracts';
import { defineAssignmentKind } from '@tortoise/assignments';
import { ${one.camel}Schema } from './${one.kebab}';

/**
 * ${kind.title} of ${many.words}: whoever takes it reports on each ${one.words} in the brief.
 * Accepting a report sets that ${one.words}'s status to the reported one.
 */
export const ${kind.camel} = defineAssignmentKind({
  id: '${kind.kebab}',
  title: '${kind.title}',
  description: 'Look at each ${one.words} in the brief and report whether it is open or done, with a note.',
  scope: z.strictObject({ ${many.camel}: z.array(recordKeySchema).min(1).max(50) }),
  brief: z.strictObject({
    ${many.camel}: z.array(
      z.strictObject({
        id: recordKeySchema,
        title: ${one.camel}Schema.shape.title,
        status: ${one.camel}Schema.shape.status,
      }),
    ),
  }),
  report: z.strictObject({ status: ${one.camel}Schema.shape.status, note: z.string().max(500) }),
  subject: '${one.kebab}',
  assigneeTypes: ['person'],
  invokes: ['${one.kebab}.update'],
  changes: ['${one.kebab}'],
});
`;

const assignmentsContract = (
  kind: Names,
) => `import { defineAssignments } from '@tortoise/assignments';
import { ${kind.camel} } from './${kind.kebab}-assignment';
// scaffold:imports

/** The application's assignment kinds and the operations generated for them. Browser-safe. */
export const assignments = defineAssignments({
  kinds: [
    ${kind.camel},
    // scaffold:assignment-kinds
  ],
});

/** The generated operations, flat, so screens bind them by name. */
export const assignmentOperations = assignments.operations;
`;

const assigneesContract = (app: AppNames) => `import { z } from 'zod';
import { defineCapability, jsonSchema } from '@tortoise/contracts';

const assigneeSchema = z.strictObject({
  type: z.literal('person'),
  id: z.string().min(1).max(256),
  label: z.string().max(300),
});

/** Who can take an assignment here: the workspace's members. */
export const assigneeList = defineCapability({
  id: 'assignee.list',
  kind: 'query',
  description: 'The members who can take an assignment, each with their role.',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ items: z.array(assigneeSchema) })),
  permission: { action: 'read', resourceType: '${app.app.pascal}' },
  ui: { binding: 'assignee.list' },
});
`;

const assigneesHandler = `import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';

/** The members, as people who can take an assignment. */
export function assigneeHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.assigneeList, (_input, ctx) => ({
      items: Object.entries(ctx.state.members)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, role]) => ({ type: 'person' as const, id, label: \`\${id} (\${role})\` })),
    })),
  ];
}
`;

const kindHooks = (
  kind: Names,
  one: Names,
  many: Names,
) => `import { ApplicationError } from '@tortoise/contracts';
import { own } from '@tortoise/runtime';
import type { StoredAssignment, StoredReport } from '@tortoise/assignments/server';
import { operations } from '../contracts';
import type { Context } from './context';

type Body = Readonly<Record<string, unknown>>;
const ${many.camel}In = (scope: Body) => scope.${many.camel} as string[];
const invalid = (message: string, field: string) =>
  new ApplicationError('INVALID_INPUT', message, { field });

/**
 * The ${kind.words} hooks, which the assignment feature calls inside its commands. The scope
 * names ${many.words} that exist, and the assignee is a member. The brief holds each
 * ${one.words}'s title and status when the assignment is sent. A report is about one of them,
 * and accepting it runs ${one.kebab}.update as the person accepting.
 */
export const ${kind.camel}Hooks = {
  scope(scope: Body, ctx: Context) {
    for (const id of ${many.camel}In(scope))
      if (!own(ctx.state.${many.camel}, id)) throw invalid(\`No ${one.words} \${id}\`, 'scope');
  },
  assignee(assignee: { readonly type: string; readonly id: string }, ctx: Context) {
    if (!own(ctx.state.members, assignee.id)) throw invalid(\`\${assignee.id} is not a member\`, 'assignee');
  },
  brief(assignment: Readonly<StoredAssignment>, ctx: Context) {
    return {
      ${many.camel}: ${many.camel}In(assignment.scope).flatMap((id) => {
        const record = own(ctx.state.${many.camel}, id);
        return record ? [{ id, title: record.title, status: record.status }] : [];
      }),
    };
  },
  subject(subject: string, assignment: Readonly<StoredAssignment>) {
    return ${many.camel}In(assignment.scope).includes(subject);
  },
  async accept(report: Readonly<StoredReport>, _input: Body, _assignment: unknown, ctx: Context) {
    if (!report.subject) throw new ApplicationError('CONFLICT', 'Link the report before accepting it');
    await ctx.invoke(operations.${one.camel}Update, {
      id: report.subject,
      status: report.body.status as 'open' | 'done',
    });
  },
};
`;

const hooksIndex = (kind: Names) => `import { byKind } from '@tortoise/assignments/server';
import { newId, now, type Context } from './context';
import { ${kind.camel}Hooks } from './${kind.kebab}-assignment';
// scaffold:imports

/** The hooks of every assignment kind, for the assignment feature's mount. */
export const assignmentHooks = {
  newId: (ctx: Context) => newId(ctx),
  now: (ctx: Context) => now(ctx),
  ...byKind<Context>({
    '${kind.kebab}': ${kind.camel}Hooks,
    // scaffold:assignment-hooks
  }),
};
`;

const screen = (
  kind: Names,
  kinds: Names,
  one: Names,
  many: Names,
) => `import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { AssignmentBoard, type AssigneeOption } from '@/components/assignment-board';
import { AssignmentReports } from '@/components/assignment-reports';
import { RecordScreen } from '@/components/collection-screen';
import { MyAssignments } from '@/components/my-assignments';
import { live } from '@/lib/session';
import { assignmentOperations, operations } from '../contracts';
import { ${kind.camel} } from '../contracts/${kind.kebab}-assignment';

const board = '/assignments/${kinds.kebab}';

/** The open ${many.words} a planner picks for the scope. */
function ScopePicker({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const query = useQuery(live.liveQueryOptions(operations.${one.camel}List, { status: 'open' }));
  const rows = (query.data as { items: { id: string; title: string }[] } | undefined)?.items ?? [];
  const chosen = new Set((value as { ${many.camel}?: string[] }).${many.camel} ?? []);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    onChange({ ${many.camel}: [...next] });
  };
  return (
    <fieldset className="space-y-1">
      {rows.map((row) => (
        <label key={row.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} />
          {row.title}
        </label>
      ))}
    </fieldset>
  );
}

function Board() {
  const assignees = useQuery(live.liveQueryOptions(operations.assigneeList, {}));
  return (
    <AssignmentBoard
      title="${kinds.title}"
      list={assignmentOperations.list}
      withdraw={assignmentOperations.withdraw}
      close={assignmentOperations.close}
      input={{ kind: '${kind.kebab}' }}
      kinds={[
        {
          kind: ${kind.camel},
          create: assignmentOperations.${kind.camel}Create,
          send: assignmentOperations.${kind.camel}Send,
          scope: ScopePicker,
        },
      ]}
      assignees={(assignees.data as { items: AssigneeOption[] } | undefined)?.items ?? []}
      aside={(assignment) => (
        <Link className="text-sm underline" to={\`\${board}/\${assignment.id}\`}>
          Reports
        </Link>
      )}
    />
  );
}

/** One ${kind.words} and its reports, each linked, discarded or accepted. */
function AssignmentScreen() {
  const { assignmentId } = useParams({ strict: false }) as { assignmentId: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="${kind.title}" get={assignmentOperations.get} param="assignmentId" />
      <AssignmentReports
        list={assignmentOperations.reportList}
        discard={assignmentOperations.reportDiscard}
        link={assignmentOperations.reportLink}
        kinds={[{ kind: ${kind.camel}, accept: assignmentOperations.${kind.camel}Accept }]}
        input={{ assignmentId }}
      />
    </div>
  );
}

/** The ${kinds.words} sent to the signed-in member, with a report form and Done. */
function Mine() {
  return (
    <MyAssignments
      title="My ${kinds.words}"
      feed={assignmentOperations.feed}
      complete={assignmentOperations.complete}
      kinds={[{ kind: ${kind.camel}, report: assignmentOperations.${kind.camel}Report }]}
    />
  );
}

/** The ${kinds.words} board, one ${kind.words} with its reports, one report, and my ${kinds.words}. */
export const ${kind.camel}Routes = [
  { path: 'assignments/${kinds.kebab}', component: Board },
  { path: 'assignments/${kinds.kebab}/$assignmentId', component: AssignmentScreen },
  {
    path: 'assignments/${kinds.kebab}/reports/$reportId',
    component: () => (
      <RecordScreen title="Report" get={assignmentOperations.reportGet} param="reportId" />
    ),
  },
  { path: 'assignments/my-${kinds.kebab}', component: Mine },
];
`;

const test = (
  app: AppNames,
  kind: Names,
  one: Names,
  many: Names,
) => `import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { create${app.app.pascal}Application } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const worker = { workspaceId: 'local', principalId: 'worker' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${kind.kebab}-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    create${app.app.pascal}Application({
      members: { worker: 'viewer' },
      services: { newId: () => \`id-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const app = instance.application;
  const run = async (operation: string, input: unknown, caller: typeof owner, key: string) =>
    (await app.invokeRaw({ operation, input, idempotencyKey: key }, caller)).result as { id: string };
  return { app, run };
}

test('${kind.a} sent to a member comes back as reports, and accepting one sets its ${one.words}', async () => {
  const { app, run } = await open();
  const first = (await run('${one.kebab}.create', { title: 'First' }, owner, 'first')).id;
  const second = (await run('${one.kebab}.create', { title: 'Second' }, owner, 'second')).id;
  const sent = await run(
    'assignment.${kind.kebab}.create',
    { title: 'Week 1', scope: { ${many.camel}: [first] }, assignee: { type: 'person', id: 'worker' } },
    owner,
    'send',
  );
  const feed = await app.queryRaw({ operation: 'assignment.feed', input: {} }, worker);
  expect(feed.data).toMatchObject({
    items: [{ id: sent.id, brief: { ${many.camel}: [{ id: first, title: 'First', status: 'open' }] } }],
  });

  const report = (id: string, subject: string) => ({
    id,
    assignmentId: sent.id,
    subject,
    body: { status: 'done', note: 'Finished.' },
  });
  // A member's report on ${one.a} outside the assignment is refused.
  await expect(
    run('assignment.${kind.kebab}.report', report('report-2', second), worker, 'outside'),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await run('assignment.${kind.kebab}.report', report('report-1', first), worker, 'report');
  await run('assignment.complete', { id: sent.id }, worker, 'complete');

  // Accepting is for editors; the accept hook updates the ${one.words} as the editor.
  await expect(
    run('assignment.${kind.kebab}.accept', { id: 'report-1' }, worker, 'worker-accept'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await run('assignment.${kind.kebab}.accept', { id: 'report-1' }, owner, 'accept');
  const record = await app.queryRaw({ operation: '${one.kebab}.get', input: { id: first } }, owner);
  expect(record.data).toMatchObject({ status: 'done' });
  await run('assignment.close', { id: sent.id }, owner, 'close');
  const board = await app.queryRaw(
    { operation: 'assignment.list', input: { kind: '${kind.kebab}' } },
    owner,
  );
  expect(board.data).toMatchObject({ items: [{ id: sent.id, stage: 'closed' }] });
});

test('a viewer may not plan, work goes only to members, and a stranger has no feed', async () => {
  const { app, run } = await open();
  const first = (await run('${one.kebab}.create', { title: 'First' }, owner, 'first')).id;
  const draft = { title: 'Week 1', scope: { ${many.camel}: [first] } };
  await expect(
    run('assignment.${kind.kebab}.create', draft, worker, 'viewer'),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    run(
      'assignment.${kind.kebab}.create',
      { ...draft, assignee: { type: 'person', id: 'stranger' } },
      owner,
      'stranger',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    app.queryRaw({ operation: 'assignment.feed', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
`;

/** Lines of the access view the assignment feature asks, inserted into \`policy.ts\`. */
const access = [
  '/**',
  ' * Who may do what with assignments, for the `assignment` feature, which never asks this policy.',
  ' * Editors plan, read and review; every member works on what is sent to them, and a delegated run',
  ' * only works. Peers and integration principals hold no role and reach none of it.',
  ' */',
  'export const assignmentAccess = (state: AppState): AssignmentAccess => ({',
  '  allows(context, action) {',
  '    const role = roleOf(state, context.principalId);',
  '    if (!role || context.peer) return false;',
  "    if (isDelegated(context)) return action === 'work';",
  "    return action === 'work' || (role === 'editor' && action !== 'integrate');",
  '  },',
  '});',
];

/** The assignment feature's mount in `application.ts`. */
const mount = [
  'mountFeature<AppState, AssignmentAccess, AssignmentHooks, Services>(',
  '  assignmentFeature(assignments),',
  '  { access: assignmentAccess, hooks: assignmentHooks },',
  '),',
];

/**
 * An assignment kind over one collection, for person assignees: the kind, its hooks, its board,
 * reports and My screens, and a lifecycle test. The first kind also adds `defineAssignments`, the
 * member list for the assignee picker, the access view and the feature's mount; a later kind
 * joins those.
 */
export function assignmentKind(app: AppNames, kind: Names, one: Names, first: boolean): Generated {
  const many = plural(one);
  const kinds = plural(kind);
  const board = `/assignments/${kinds.kebab}`;
  const mine = `/assignments/my-${kinds.kebab}`;
  const files: Record<string, string> = {
    [`contracts/${kind.kebab}-assignment.ts`]: kindContract(kind, one, many),
    [`handlers/${kind.kebab}-assignment.ts`]: kindHooks(kind, one, many),
    [`ui/${kind.kebab}-assignments.tsx`]: screen(kind, kinds, one, many),
    [`test/${kind.kebab}-assignment.test.ts`]: test(app, kind, one, many),
  };
  const screens = {
    imports: [`import { ${kind.camel}Routes } from './ui/${kind.kebab}-assignments';`],
    routes: [`...${kind.camel}Routes,`],
    navigation: [
      `{ to: '${board}', label: '${kinds.title}', icon: List },`,
      `{ to: '${mine}', label: 'My ${kinds.words}', icon: List },`,
    ],
    'capability-screens': [
      `{ prefix: 'assignment.${kind.kebab}.', to: '${board}' },`,
      `{ prefix: 'assignment.${kind.kebab}.report', to: '${mine}' },`,
      ...(first
        ? [
            `{ prefix: 'assignment.', to: '${board}' },`,
            `{ prefix: 'assignment.feed', to: '${mine}' },`,
            `{ prefix: 'assignment.complete', to: '${mine}' },`,
            `{ prefix: 'assignee.', to: '${board}' },`,
          ]
        : []),
    ],
  };
  const kindImport = `import { ${kind.camel} } from './${kind.kebab}-assignment';`;
  const hooksImport = `import { ${kind.camel}Hooks } from './${kind.kebab}-assignment';`;
  if (!first)
    return {
      files,
      insertions: {
        'contracts/assignments.ts': {
          imports: [kindImport],
          'assignment-kinds': [`${kind.camel},`],
        },
        'handlers/assignments.ts': {
          imports: [hooksImport],
          'assignment-hooks': [`'${kind.kebab}': ${kind.camel}Hooks,`],
        },
        'screens.tsx': screens,
      },
    };
  return {
    files: {
      ...files,
      'contracts/assignments.ts': assignmentsContract(kind),
      'contracts/assignees.ts': assigneesContract(app),
      'handlers/assignments.ts': hooksIndex(kind),
      'handlers/assignees.ts': assigneesHandler,
    },
    insertions: {
      'contracts.ts': {
        imports: [
          `import { assigneeList } from './contracts/assignees';`,
          // Screens bind the feature's operations through this module, as they do the application's.
          `export { assignmentOperations } from './contracts/assignments';`,
        ],
        operations: ['assigneeList,'],
      },
      'manifest.ts': {
        imports: [`import { assignments } from './contracts/assignments';`],
        features: ['assignments.manifest,'],
      },
      'policy.ts': {
        imports: [
          `import { isDelegated } from '@tortoise/runtime';`,
          `import type { AssignmentAccess } from '@tortoise/assignments/server';`,
        ],
        rules: [`[operations.assigneeList.id]: 'open',`],
        access,
      },
      'server.ts': {
        imports: [`import { assigneeHandlers } from './handlers/assignees';`],
        handlers: ['...assigneeHandlers(),'],
      },
      'application.ts': {
        imports: [
          `import { assignmentFeature, type AssignmentAccess, type AssignmentHooks } from '@tortoise/assignments/server';`,
          `import { mountFeature } from '@tortoise/host/feature';`,
          `import { assignments } from './contracts/assignments';`,
          `import { assignmentHooks } from './handlers/assignments';`,
          `import { assignmentAccess } from './policy';`,
        ],
        features: mount,
      },
      'screens.tsx': screens,
    },
  };
}
