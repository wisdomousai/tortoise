import type { AnyCapability } from '@tortoise/contracts';
import { isDelegated, own, type Decision, type ExecutionContext } from '@tortoise/runtime';
import type { Assignee } from '../schemas';
import type { AssignmentAccess, AssignmentAction } from './hooks';
import {
  assignmentResource,
  reportResource,
  type AssignmentSlice,
  type StoredAssignment,
  type StoredReport,
} from './slice';

/**
 * Whether `context` is the assignee itself: the person with no grant and no peer, a run of the
 * agent definition, the device's principal, or the peer application's service principal. A
 * assignment target is never a caller; its results are applied by the target's sync.
 */
export function isAssignee(context: ExecutionContext, assignee: Assignee | undefined): boolean {
  if (!assignee) return false;
  switch (assignee.type) {
    case 'person':
      return !isDelegated(context) && !context.peer && context.principalId === assignee.id;
    case 'agent':
      return context.grant?.agent === assignee.id && context.runId !== undefined;
    case 'device':
      return context.principalId === `device:${assignee.id}` && !context.peer;
    case 'peer':
      return context.peer?.id === assignee.id && context.peer.subject === undefined;
    case 'target':
      return false;
  }
}

/** A delegated grant's resource scope applies to reads too. */
const inGrant = (context: ExecutionContext, resource: string) =>
  !context.grant?.resources || context.grant.resources.includes(resource);

/** Whether the caller may see an assignment: as a reader of its kind, or as its assignee. */
export function canSee(
  context: ExecutionContext,
  access: AssignmentAccess,
  assignment: StoredAssignment,
): boolean {
  if (!inGrant(context, assignmentResource(assignment.id))) return false;
  return (
    access.allows(context, 'read', assignment.kind) ||
    (isAssignee(context, assignment.assignee) &&
      access.allows(context, 'work', assignment.kind) &&
      assignment.status !== 'draft')
  );
}

/** Whether the caller may see a report: whoever may see its assignment, within a grant's scope. */
export function canSeeReport(
  context: ExecutionContext,
  access: AssignmentAccess,
  slice: AssignmentSlice,
  report: StoredReport,
): boolean {
  const assignment = own(slice.assignments, report.assignmentId);
  if (!assignment) return false;
  const scoped =
    inGrant(context, reportResource(report.id)) ||
    inGrant(context, assignmentResource(assignment.id));
  return (
    scoped &&
    (access.allows(context, 'read', assignment.kind) ||
      (isAssignee(context, assignment.assignee) && access.allows(context, 'work', report.kind)))
  );
}

/** The operation's class, from its ID: a kind's command, a generic operation or an assignment target's. */
export type Classified =
  | { readonly kind: string; readonly op: 'create' | 'send' | 'report' | 'accept' }
  | { readonly target: string; readonly op: 'complete' | 'sync' | 'status' }
  | { readonly op: Generic };
type Generic =
  | 'withdraw'
  | 'complete'
  | 'close'
  | 'list'
  | 'get'
  | 'inbound'
  | 'report.list'
  | 'report.get'
  | 'report.link'
  | 'report.discard';

export function classify(
  id: string,
  kinds: ReadonlySet<string>,
  targets: ReadonlySet<string>,
): Classified {
  const rest = id.slice('assignment.'.length);
  const dot = rest.indexOf('.');
  const head = dot < 0 ? rest : rest.slice(0, dot);
  const tail = dot < 0 ? '' : rest.slice(dot + 1);
  if (kinds.has(head) && ['create', 'send', 'report', 'accept'].includes(tail))
    return { kind: head, op: tail as 'create' };
  if (targets.has(head) && ['complete', 'sync', 'status'].includes(tail))
    return { target: head, op: tail as 'complete' };
  return { op: rest as Generic };
}

const ALLOW: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

/**
 * One snapshot's decision: the slice and the access view computed from the same state. A record
 * the caller cannot see passes on the gate of its kind or of reading at all, and the handler then
 * reports it missing, so a refusal never confirms that a hidden record exists.
 */
export function decide(
  operation: Classified,
  input: Record<string, unknown>,
  context: ExecutionContext,
  slice: AssignmentSlice,
  access: AssignmentAccess,
  principals: Readonly<Record<string, string>>,
): boolean {
  const assignment = (id: unknown) =>
    typeof id === 'string' ? own(slice.assignments, id) : undefined;
  const report = (id: unknown) => (typeof id === 'string' ? own(slice.reports, id) : undefined);
  if ('target' in operation) {
    const principal = principals[operation.target];
    const integrates =
      access.allows(context, 'integrate', operation.target) &&
      (principal === undefined || principal === context.principalId);
    // The integration principal reads its watermark through status; the counts it sees are empty.
    return operation.op === 'status' ? integrates || access.allows(context, 'read') : integrates;
  }
  if ('kind' in operation) {
    const { kind } = operation;
    switch (operation.op) {
      case 'create':
        return access.allows(context, 'plan', kind);
      case 'send': {
        const found = assignment(input.id);
        return access.allows(
          context,
          'plan',
          found && canSee(context, access, found) ? found.kind : kind,
        );
      }
      case 'report': {
        const found = assignment(input.assignmentId);
        if (!access.allows(context, 'work', kind)) return false;
        // The assignee itself, or a caller that cannot see the assignment and is told it is missing.
        return !found || isAssignee(context, found.assignee) || !canSee(context, access, found);
      }
      case 'accept': {
        const found = report(input.id);
        return access.allows(
          context,
          'review',
          found && canSeeReport(context, access, slice, found) ? found.kind : kind,
        );
      }
    }
  }
  const visible = assignment(input.id);
  const seen = visible && canSee(context, access, visible) ? visible : undefined;
  const reported = report(input.id);
  const seenReport =
    reported && canSeeReport(context, access, slice, reported) ? reported : undefined;
  switch (operation.op) {
    case 'list':
    case 'report.list':
      return access.allows(context, 'read');
    case 'get':
      return seen ? true : access.allows(context, 'read');
    case 'inbound':
      return access.allows(context, 'work');
    case 'withdraw':
      return seen ? access.allows(context, 'plan', seen.kind) : access.allows(context, 'read');
    case 'complete':
      return seen
        ? (isAssignee(context, seen.assignee) && access.allows(context, 'work', seen.kind)) ||
            access.allows(context, 'plan', seen.kind)
        : access.allows(context, 'read') || access.allows(context, 'work');
    case 'close':
      return seen ? access.allows(context, 'review', seen.kind) : access.allows(context, 'read');
    case 'report.get':
      return seenReport ? true : access.allows(context, 'read');
    case 'report.link':
    case 'report.discard':
      return seenReport
        ? access.allows(context, 'review', seenReport.kind)
        : access.allows(context, 'read');
  }
}

/** The feature's policy over its slice and the application's access view. */
export function assignmentPolicy(
  kinds: ReadonlySet<string>,
  targets: ReadonlySet<string>,
  principals: Readonly<Record<string, string>>,
) {
  const classified = (capability: AnyCapability) => classify(capability.id, kinds, targets);
  return {
    authorize({
      capability,
      input,
      context,
      state,
      access,
      previousState,
      previousAccess,
    }: {
      readonly capability: AnyCapability;
      readonly input: unknown;
      readonly context: ExecutionContext;
      readonly state: AssignmentSlice;
      readonly access: AssignmentAccess;
      readonly previousState?: AssignmentSlice;
      readonly previousAccess?: AssignmentAccess;
    }): Decision {
      const operation = classified(capability);
      if ('kind' in operation && operation.op === 'accept' && isDelegated(context))
        return deny('PERSON_ONLY');
      const fields = (input ?? {}) as Record<string, unknown>;
      const allowed =
        decide(operation, fields, context, state, access, principals) &&
        (previousState === undefined ||
          previousAccess === undefined ||
          decide(operation, fields, context, previousState, previousAccess, principals));
      return allowed ? ALLOW : deny('RESOURCE_DENIED');
    },
    canReadEvent({
      event,
      state,
      context,
      access,
    }: {
      readonly event: { readonly resource: string };
      readonly state: AssignmentSlice;
      readonly context: ExecutionContext;
      readonly access: AssignmentAccess;
    }): boolean {
      const separator = event.resource.indexOf(':');
      const type = event.resource.slice(0, separator);
      const id = event.resource.slice(separator + 1);
      if (type === 'assignment') {
        const found = own(state.assignments, id);
        return !!found && canSee(context, access, found);
      }
      const found = own(state.reports, id);
      return !!found && canSeeReport(context, access, state, found);
    },
  };
}
