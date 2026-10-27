import {
  definePolicy,
  own,
  type ApprovalAccess,
  type OperationRule,
  type ReconciliationAccess,
} from '@agent-native/runtime';
import { targetAllowlist, targetRules } from '@agent-native/integration';
import { operations } from './contracts';
import { erpTarget } from './contracts/erp-target';
import { qualityPeer } from './contracts/quality-peer';
import type { AppState, Role } from './domain';
// scaffold:imports

const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
/** Commands that change records: editors only. Reads are open to members, scoped in handlers. */
const editor: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Workspace policy. Only members pass the caller gate; integration principals hold no role and
 * call only the operations their integration allowlist lists. An operation this policy does not list is denied. The approval
 * and reconciliation features decide their own operations over the access views below.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    targetAllowlist(erpTarget, (_state, principalId) => principalId === 'erp-integration'),
    targetAllowlist(qualityPeer, (_state, principalId) => principalId === 'quality-integration'),
    // scaffold:integrations
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [operations.deliveryList.id]: 'open',
    [operations.deliveryGet.id]: 'open',
    [operations.deliveryReceive.id]: editor,
    [operations.deliveryClassify.id]: editor,
    ...targetRules(erpTarget),
    [operations.erpSend.id]: editor,
    ...targetRules(qualityPeer),
    // Live reads as the caller's person in quality inspection, whose plant roles decide there.
    [operations.qualityLotSearch.id]: 'open',
    [operations.qualityLotLookup.id]: 'open',
    // scaffold:rules
  },
  events: {
    // Feed and delivery state is visible to every member.
    sync: () => true,
    delivery: () => true,
    // scaffold:events
  },
});

/**
 * Who may do what with approval requests. Only members pass, as the caller gate requires, so the
 * ERP's integration principal is refused. Any member may request, approve and read; the
 * discrepancy agent requests under the delegated grant of the member who started it, and the
 * feature refuses approving to a delegated caller. Approving runs the requested command under
 * the approver, so its own editor rule applies again. Only editors reject.
 */
export const approvalAccess = (state: AppState): ApprovalAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    if (role === undefined) return false;
    return action !== 'reject' || role === 'editor';
  },
});

/**
 * Who may reconcile held goods receipts: members list them and editors decide. Every member sees
 * every held receipt, as they see every line.
 */
export const reconciliationAccess = (state: AppState): ReconciliationAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    return action === 'read' ? role !== undefined : role === 'editor';
  },
  sees: (context, effect) =>
    roleOf(state, context.principalId) !== undefined && effect.resource.startsWith('delivery:'),
});
