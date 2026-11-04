import type { ExecutionContext } from '@tortoise/runtime';
import type { AnyAssignmentKind } from '../kind';
import type { Assignee, StoredBody } from '../schemas';
import type { StoredAssignment, StoredReport } from './slice';

/** What a caller does with assignments; the feature also matches an assignee by itself. */
export type AssignmentAction = 'plan' | 'read' | 'work' | 'review' | 'integrate';

/**
 * The application's decision on who may do what with assignments. The feature's policy asks only
 * this; the application's own policy never sees assignment operations, so `allows` must apply
 * the application's membership gate itself.
 */
export interface AssignmentAccess {
  /**
   * Whether `context` may take `action` on assignments of kind `scope`, or for `integrate`, on
   * the assignment target named `scope`. Without `scope`: whether it may take the action on any kind,
   * which gates the generic reads.
   *
   * - `plan`: create, send and withdraw assignments, and mark one done for its assignee;
   * - `read`: see assignments and their reports;
   * - `work`: take assignments sent to the caller and report on them;
   * - `review`: link, discard and accept reports, and close assignments;
   * - `integrate`: complete offers to an assignment target and apply its results.
   */
  allows(context: ExecutionContext, action: AssignmentAction, scope?: string): boolean;
}

/**
 * Application code the feature calls inside a command; each defaults when omitted. The kind is
 * the first argument, so one implementation serves every kind (see `byKind`).
 */
export interface AssignmentHooks {
  /** A new assignment ID; `crypto.randomUUID()` when omitted. */
  newId?(): string;
  /** The current time in milliseconds; `Date.now()` when omitted. */
  now?(): number;
  /** Check a new scope against the application's records; throw `INVALID_INPUT` to refuse it. */
  scope?(kind: string, scope: StoredBody): void;
  /** Check an assignee before sending; throw `INVALID_INPUT` to refuse it. */
  assignee?(kind: string, assignee: Assignee): void;
  /** The brief an assignment carries, from its scope; the scope itself when omitted. */
  brief?(kind: string, assignment: Readonly<StoredAssignment>): StoredBody;
  /** Whether the assignment covers the record a report names. Every subject when omitted. */
  subject?(kind: string, subject: string, assignment: Readonly<StoredAssignment>): boolean;
  /**
   * Write an accepted report into the application's records, with what the reviewer gave. It
   * runs in the accept command's transaction; a throw refuses the accept and writes nothing.
   */
  accept?(
    kind: string,
    report: Readonly<StoredReport>,
    input: StoredBody,
    assignment: Readonly<StoredAssignment>,
  ): void | Promise<void>;
}

type PerKind<Hook> = Hook extends (kind: string, ...rest: infer Rest) => infer R
  ? (...rest: Rest) => R
  : never;
type KindHooks = {
  readonly [H in 'scope' | 'assignee' | 'brief' | 'subject' | 'accept']?: PerKind<
    NonNullable<AssignmentHooks[H]>
  >;
};

/**
 * One set of hooks from per-kind implementations, for `mountFeature`. A hook a kind does not
 * implement falls back to the feature's default for that kind.
 */
export function byKind<Context>(
  kinds: Readonly<
    Record<string, { readonly [H in keyof KindHooks]?: Bind<KindHooks[H], Context> }>
  >,
): { readonly [H in keyof KindHooks]: Bind<AssignmentHooks[H], Context> } {
  const dispatch =
    (hook: keyof KindHooks, fallback: unknown) =>
    (kind: string, ...rest: unknown[]) => {
      const own = Object.hasOwn(kinds, kind) ? kinds[kind]?.[hook] : undefined;
      return own ? (own as (...args: unknown[]) => unknown)(...rest) : fallback;
    };
  return {
    scope: dispatch('scope', undefined),
    assignee: dispatch('assignee', undefined),
    brief: (kind: string, assignment: StoredAssignment, context: Context) => {
      const own = Object.hasOwn(kinds, kind) ? kinds[kind]?.brief : undefined;
      return own
        ? (own as (...args: unknown[]) => StoredBody)(assignment, context)
        : assignment.scope;
    },
    subject: dispatch('subject', true),
    accept: dispatch('accept', undefined),
  } as never;
}
/** A hook with the application's handler context appended, as `mountFeature` binds it. */
type Bind<Hook, Context> = Hook extends (...args: infer A) => infer R
  ? (...args: [...A, Context]) => R
  : never;

/** The kinds, by ID. */
export const kindsById = (kinds: readonly AnyAssignmentKind[]) =>
  new Map(kinds.map((kind) => [kind.id, kind]));
