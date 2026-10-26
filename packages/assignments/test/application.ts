import { ApplicationError } from '@agent-native/contracts';
import {
  createApplicationRuntime,
  defineApplication,
  defineManifest,
  mountFeature,
} from '@agent-native/kernel';
import {
  createMemoryBlobStore,
  createMemoryStorage,
  definePolicy,
  isDelegated,
  type ExecutionContext,
  type HandlerContext,
} from '@agent-native/runtime';
import {
  assignmentFeature,
  byKind,
  type AssignmentAccess,
  type AssignmentFeatureOptions,
  type AssignmentHooks,
  type AssignmentSlice,
} from '../src/server';
import { assignments, checker, noteUpdate, notesModule } from './fixture';

export const WORKSPACE = 'w';
export const INTEGRATION = 'integration';
export type Role = 'planner' | 'worker';
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly comments: string[];
}
export interface Root {
  readonly members: Record<string, Role>;
  readonly notes: Record<string, Note>;
  readonly assignment?: AssignmentSlice;
}
type Ctx = HandlerContext<Root, unknown>;

export const as = (principalId: string, extra: Partial<ExecutionContext> = {}) =>
  ({ workspaceId: WORKSPACE, principalId, ...extra }) as ExecutionContext;
export const planner = as('pat');
export const worker = as('wes');
export const outsider = as('olga');
export const device = as('device:tab-1');

/**
 * Who may do what: planners plan, read and review; workers, paired devices, peers and agent runs
 * work; the integration principal integrates. A delegated run of a planner works only.
 */
export function access(state: Root): AssignmentAccess {
  return {
    allows(context, action) {
      const { principalId } = context;
      if (principalId === INTEGRATION) return action === 'integrate';
      if (principalId.startsWith('device:') || principalId.startsWith('peer:'))
        return action === 'work';
      const role = Object.hasOwn(state.members, principalId)
        ? state.members[principalId]
        : undefined;
      if (!role) return false;
      if (isDelegated(context)) return action === 'work' || action === 'read';
      if (role === 'planner') return action !== 'integrate';
      return action === 'work';
    },
  };
}

let sequence = 0;
/** The review kind's hooks: the brief holds the notes in scope, and accepting adds a comment. */
export const hooks = {
  newId: () => `a${++sequence}`,
  now: () => 1_000,
  ...byKind<Ctx>({
    review: {
      scope: (scope, ctx) => {
        for (const id of scope.notes as string[])
          if (!Object.hasOwn(ctx.state.notes, id))
            throw new ApplicationError('INVALID_INPUT', 'Unknown note', { field: 'scope' });
      },
      brief: (assignment, ctx) => ({
        notes: (assignment.scope.notes as string[]).map((id) => {
          const { title, body } = ctx.state.notes[id]!;
          return { id, title, body };
        }),
        ...(assignment.scope.attachments ? { attachments: assignment.scope.attachments } : {}),
      }),
      subject: (subject, assignment) => (assignment.scope.notes as string[]).includes(subject),
      accept: async (report, input, _assignment, ctx) => {
        const comment = (input.comment as string | undefined) ?? (report.body.comment as string);
        await ctx.invoke(noteUpdate, { id: report.subject!, comment });
      },
    },
    'field-survey': { brief: () => ({ nodes: [{ id: 'n1', designation: '=A1' }] }) },
  }),
} satisfies Record<string, unknown>;

const manifest = defineManifest({
  id: 'assignments-fixture',
  title: 'Assignments fixture',
  modules: [notesModule],
  features: [assignments.manifest],
  components: [checker],
});

/** The fixture application with the assignment feature mounted, on memory storage. */
export function createFixture(options: AssignmentFeatureOptions = {}) {
  sequence = 0;
  const definition = defineApplication<Root>({
    manifest,
    createState: () => ({
      members: { pat: 'planner', wes: 'worker' },
      notes: {
        n1: { id: 'n1', title: 'Pumps', body: 'Check the seals.', comments: [] },
        n2: { id: 'n2', title: 'Valves', body: 'Replace two.', comments: [] },
      },
    }),
    handlers: [
      {
        capability: noteUpdate,
        handle: (input, ctx) => {
          const note = ctx.state.notes[(input as { id: string }).id];
          if (!note) throw new ApplicationError('NOT_FOUND', 'Note unavailable');
          note.comments.push((input as { comment: string }).comment);
          ctx.change(`note:${note.id}`);
          return { id: note.id, comments: note.comments };
        },
      },
    ],
    authorization: definePolicy<Root>({
      caller: { allow: (state, context) => Object.hasOwn(state.members, context.principalId) },
      operations: { [noteUpdate.id]: 'open' },
      events: { note: () => true, sync: () => true },
    }),
    features: [
      mountFeature<Root, AssignmentAccess, AssignmentHooks>(
        assignmentFeature(assignments, options),
        {
          access,
          hooks: hooks as never,
        },
      ),
    ],
  });
  const blobs = createMemoryBlobStore();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(() => definition.createState(WORKSPACE)),
    blobStore: () => blobs,
    now: () => 1_000,
  });
  return { definition, application };
}
