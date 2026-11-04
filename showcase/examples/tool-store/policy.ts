import {
  definePolicy,
  isDelegated,
  own,
  type ApprovalAccess,
  type OperationRule,
  type ReconciliationAccess,
} from '@tortoise/runtime';
import { operations } from './contracts';
import type { AppState, Role } from './domain';
import type { HandoverAccess } from './features/handover/feature';
import type { DeviceAccess } from '@tortoise/devices/server';
import { counterStation } from './scanner';
import { targetAllowlist, targetRules } from '@tortoise/integration';
import { eamTarget } from './contracts/eam-target';
import type { AssignmentAccess } from '@tortoise/assignments/server';
// scaffold:imports

/** The EAM connector's principal. It holds no role and calls only the EAM target's operations. */
export const eamPrincipal = 'eam-integration';

// #region rules
const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
/** Commands that change records: attendants only. Reads are open to members, scoped in handlers. */
const attendant: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'attendant',
};

/**
 * Workspace policy. Only members pass the caller gate; integration principals hold no role and
 * call only the operations their integration allowlist lists. An operation this policy does not list is denied.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    targetAllowlist(eamTarget, (_state, principalId) => principalId === eamPrincipal),
    // scaffold:integrations
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [operations.toolList.id]: 'open',
    [operations.toolGet.id]: 'open',
    [operations.toolCreate.id]: attendant,
    [operations.toolUpdate.id]: attendant,
    [operations.loanList.id]: 'open',
    [operations.loanGet.id]: 'open',
    [operations.toolCheckOut.id]: attendant,
    [operations.toolReturn.id]: attendant,
    [operations.loanOverdue.id]: 'open',
    ...targetRules(eamTarget),
    [operations.toolRetire.id]: attendant,
    [operations.toolMarkMissing.id]: attendant,
    [operations.toolMarkFound.id]: attendant,
    [operations.assigneeList.id]: 'open',
    [operations.toolCalibrationDue.id]: 'open',
    // scaffold:rules
  },
  events: {
    // Inbound sync and delivery state is visible to every member.
    sync: () => true,
    tool: () => true,
    loan: () => true,
    // scaffold:events
  },
});
// #endregion rules

/**
 * Who may do what in the handover feature: every member reads, attendants record. Integration
 * principals hold no role, so they reach neither. The feature itself refuses delegated runs for
 * recording.
 */
// #region handover-access
export const handoverAccess = (state: AppState): HandoverAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    return action === 'read' ? role !== undefined : role === 'attendant';
  },
});
// #endregion handover-access

/**
 * Who may configure the counter's scanner in the device feature: attendants administer the counter
 * station, viewers read its configuration. Non-members and integration principals hold no role, so
 * they reach neither, and no other station exists. The feature applies a delegated grant's
 * `device:<station>` scope itself.
 */
export const deviceAccess = (state: AppState): DeviceAccess => ({
  relation(context, station) {
    if (station !== counterStation) return undefined;
    const role = roleOf(state, context.principalId);
    return role === 'attendant' ? 'administer' : role === 'viewer' ? 'read' : undefined;
  },
});

/**
 * Who may reconcile held EAM deliveries: every member reads them and attendants decide, the
 * application's own split between reading and changing records. Integration principals hold no
 * role, so they reach neither, and the feature itself refuses a delegated decision. Every member
 * sees every loan, so a caller who may read sees every held repair order.
 */
export const reconciliationAccess = (state: AppState): ReconciliationAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    return action === 'read' ? role !== undefined : role === 'attendant';
  },
  sees: (_context, effect) => effect.target === eamTarget.target,
});

/**
 * Who may do what with approval requests in the approval feature: every member reads and
 * requests them, attendants approve, reject and expire them. Approving runs the requested command
 * as the attendant, so `tool.retire`'s own rule applies too. Integration principals hold no role,
 * so they reach none of it, and the feature itself refuses a delegated approval or rejection.
 * Every member sees every tool, so a caller who may read sees every approval request.
 */
export const approvalAccess = (state: AppState): ApprovalAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    return action === 'read' || action === 'request' ? role !== undefined : role === 'attendant';
  },
});

/**
 * Who may do what with cycle counts in the assignment feature, which never asks this policy:
 * attendants plan, work and review them, every member reads them. A delegated run only reads,
 * because only a person counts a bin, and the feature itself refuses a delegated accept. Peers and
 * integration principals hold no role and reach none of it.
 */
export const assignmentAccess = (state: AppState): AssignmentAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    if (!role || context.peer) return false;
    if (action === 'read') return true;
    return role === 'attendant' && action !== 'integrate' && !isDelegated(context);
  },
});
// scaffold:access
