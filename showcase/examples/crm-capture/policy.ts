import { targetAllowlist, targetRules } from '@tortoise/integration';
import { definePolicy, own, type OperationRule } from '@tortoise/runtime';
import { crmAccounts, crmContacts, operations } from './contracts';
import { crmTarget } from './contracts/target';
import { memberOf, visibleAccount, type CrmState } from './domain';

const accountIdOf = (input: Record<string, unknown>) =>
  String(input.id ?? input.accountId ?? input.externalId);
/** An operation on one account: a resource grant must name it, and the caller must see it. */
const onAccount: OperationRule<CrmState, never> = {
  grant: (input) => `account:${accountIdOf(input)}`,
  allow: ({ state, context, input }) =>
    !!visibleAccount(state, context.principalId, accountIdOf(input)),
};
const open = Object.fromEntries(
  [...crmAccounts.capabilities, ...crmContacts.capabilities, operations.accountList].map(
    (capability) => [capability.id, 'open' as const],
  ),
);

/**
 * Membership and region policy. Searches, lists and status are open to members and scoped to
 * their regions in the handlers, before anything is counted. The integration principal may only
 * apply the feed, complete outcomes and read the watermark; nobody else may do either.
 */
export const crmPolicy = definePolicy<CrmState, never>({
  integrations: [
    targetAllowlist(
      crmTarget,
      (state, principalId) => principalId === state.integrationPrincipalId,
    ),
  ],
  caller: { allow: (state, context) => !!memberOf(state, context.principalId) },
  operations: {
    ...open,
    ...targetRules(crmTarget),
    [operations.accountGet.id]: onAccount,
    [operations.activityLog.id]: onAccount,
    // Following starts with an account this workspace does not hold yet; the CRM decides then.
    [operations.accountFollow.id]: { grant: onAccount.grant! },
  },
  events: {
    sync: () => true,
    account: (id, state, context) => !!visibleAccount(state, context.principalId, id),
    activity: (id, state, context) => {
      const activity = own(state.activities, id);
      return !!activity && !!visibleAccount(state, context.principalId, activity.accountId);
    },
  },
});
