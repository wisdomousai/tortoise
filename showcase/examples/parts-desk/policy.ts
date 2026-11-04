import { definePolicy, own, type ApprovalAccess, type OperationRule } from '@tortoise/runtime';
import { operations } from './contracts';
import { DESK_DISCOUNT_LIMIT } from './contracts/quote';
import type { AppState, Role } from './domain';
// scaffold:imports

const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
const atDesk = (role: Role | undefined) => role === 'desk' || role === 'supervisor';
/**
 * Commands that change records: desk members and supervisors. Reads are open to members, scoped
 * in handlers.
 */
const desk: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => atDesk(roleOf(state, context.principalId)),
};
/**
 * quote.discount: the desk up to 10 percent, a supervisor above it. A run under an agent
 * definition (its grant names the agent) stays within the desk's limit whoever started it, so a
 * supervisor's agent cannot give what only the supervisor at a screen may. The rule reads the
 * role from stored state on the current and the proposed snapshot, and the percent from the
 * validated input.
 */
// #region discount
const discount: OperationRule<AppState, Role> = {
  allow: ({ state, context, input }) => {
    const role = roleOf(state, context.principalId);
    if (!atDesk(role)) return false;
    const percent = typeof input.percent === 'number' ? input.percent : Number.POSITIVE_INFINITY;
    if (percent <= DESK_DISCOUNT_LIMIT) return true;
    return role === 'supervisor' && context.grant?.agent === undefined;
  },
};
// #endregion discount

/**
 * Workspace policy. Only members pass the caller gate; integration principals hold no role and
 * call only the operations their integration allowlist lists. An operation this policy does not list is denied.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    // scaffold:integrations
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [operations.inquiryList.id]: 'open',
    [operations.inquiryGet.id]: 'open',
    [operations.inquiryCreate.id]: desk,
    [operations.inquiryUpdate.id]: desk,
    [operations.customerList.id]: 'open',
    [operations.customerGet.id]: 'open',
    [operations.customerCreate.id]: desk,
    [operations.customerUpdate.id]: desk,
    [operations.transformerList.id]: 'open',
    [operations.transformerGet.id]: 'open',
    [operations.transformerCreate.id]: desk,
    [operations.transformerUpdate.id]: desk,
    [operations.partList.id]: 'open',
    [operations.partGet.id]: 'open',
    [operations.partCreate.id]: desk,
    [operations.partUpdate.id]: desk,
    [operations.transformerFind.id]: 'open',
    [operations.partSearch.id]: 'open',
    [operations.quoteList.id]: 'open',
    [operations.quoteGet.id]: 'open',
    [operations.quoteCreate.id]: desk,
    [operations.quoteUpdate.id]: desk,
    [operations.quoteDiscount.id]: discount,
    [operations.quoteSubmit.id]: desk,
    [operations.quoteCancel.id]: desk,
    [operations.memberCurrent.id]: 'open',
    // scaffold:rules
  },
  events: {
    // Inbound sync and delivery state is visible to every member.
    sync: () => true,
    inquiry: () => true,
    customer: () => true,
    transformer: () => true,
    part: () => true,
    quote: () => true,
    // scaffold:events
  },
});

/**
 * Who may do what with approval requests, for the `approval` feature. Every member reads them.
 * Desk members and supervisors request, approve and expire them; approving runs the requested
 * command under the approver, so the command's own rule decides, and a desk member who approves a
 * discount above 10 percent is refused by `quote.discount`. Only supervisors reject. Integration
 * principals hold no role and reach none of it. The assistant's runs are not resource-scoped, so
 * no grant resources need checking here.
 */
export const approvalAccess = (state: AppState): ApprovalAccess => ({
  allows(context, action) {
    const role = roleOf(state, context.principalId);
    if (action === 'read') return role !== undefined;
    if (action === 'reject') return role === 'supervisor';
    return atDesk(role);
  },
});
// scaffold:access
