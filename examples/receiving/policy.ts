import { definePolicy, own, type OperationRule } from '@agent-native/runtime';
import { targetLane, targetRules } from '@agent-native/integration';
import { operations } from './contracts';
import { erpTarget } from './contracts/erp-target';
import type { AppState, Role } from './domain';
// scaffold:imports

const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
/** Commands that change records: editors only. Reads are open to members, scoped in handlers. */
const editor: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Workspace policy. Only members pass the caller gate; integration principals hold no role and
 * act only in their own lanes. An operation this policy does not list is denied.
 *
 * Any member may propose; the agent proposes under the delegated grant of the member who started
 * it. Accepting runs the proposed command under the accepter, so its own editor rule applies
 * again. Deciding a proposal needs a person.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    targetLane(erpTarget, (_state, principalId) => principalId === 'erp-integration'),
    // scaffold:lanes
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [operations.deliveryList.id]: 'open',
    [operations.deliveryGet.id]: 'open',
    [operations.deliveryReceive.id]: editor,
    [operations.deliveryClassify.id]: editor,
    ...targetRules(erpTarget),
    [operations.erpSend.id]: editor,
    [operations.proposalSubmit.id]: {},
    [operations.proposalAccept.id]: { person: true },
    [operations.proposalReject.id]: { ...editor, person: true },
    [operations.proposalExpire.id]: {},
    [operations.proposalList.id]: 'open',
    [operations.proposalGet.id]: 'open',
    // scaffold:rules
  },
  events: {
    // Feed, delivery and proposal state is visible to every member.
    sync: () => true,
    delivery: () => true,
    proposal: () => true,
    // scaffold:events
  },
});
