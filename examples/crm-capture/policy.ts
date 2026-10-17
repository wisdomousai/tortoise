import { own, type AuthorizationPort } from '@agent-native/runtime';
import { crmAccounts, crmContacts, operations } from './contracts';
import { memberOf, visibleAccount, type CrmState } from './domain';

const known = new Set<string>([
  ...crmAccounts.capabilities.map((capability) => capability.id),
  ...crmContacts.capabilities.map((capability) => capability.id),
  ...Object.values(operations).map((operation) => operation.id),
]);
const integrationOnly = new Set<string>([operations.accountSync.id, operations.effectSettle.id]);
/** Operations on one account: the caller must see it, and a resource grant must name it. */
const accountScoped = new Set<string>([
  operations.accountGet.id,
  operations.accountAdopt.id,
  operations.activityLog.id,
]);

const accountIdOf = (input: unknown) => {
  const args = input as { id?: unknown; accountId?: unknown; externalId?: unknown };
  return String(args.id ?? args.accountId ?? args.externalId);
};

/**
 * Membership and region policy. Searches, lists and status are open to members and scoped to
 * their regions in the handlers, before anything is counted. The integration principal may only
 * apply the feed, settle outcomes and read the watermark; nobody else may do either.
 */
export const crmPolicy: AuthorizationPort<CrmState> = {
  authorize({ capability, input, context, state, previousState }) {
    const operation = capability.id;
    if (!known.has(operation)) return { allowed: false, reason: 'NO_POLICY' };
    const integration = context.principalId === state.integrationPrincipalId;
    if (integrationOnly.has(operation)) return { allowed: integration, reason: 'INTEGRATION_ONLY' };
    if (integration)
      return { allowed: operation === operations.syncStatus.id, reason: 'INTEGRATION_SCOPE' };
    if (!memberOf(state, context.principalId)) return { allowed: false, reason: 'NOT_A_MEMBER' };
    if (!accountScoped.has(operation)) return { allowed: true };
    const id = accountIdOf(input);
    if (context.grant?.resources && !context.grant.resources.includes(`account:${id}`))
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    // Adopting starts with an account this workspace does not hold yet; the CRM decides then.
    if (operation === operations.accountAdopt.id) return { allowed: true };
    const sees = (snapshot: CrmState) => !!visibleAccount(snapshot, context.principalId, id);
    return {
      allowed: sees(state) && (!previousState || sees(previousState)),
      reason: 'RESOURCE_DENIED',
    };
  },
  canReadEvent({ state, context, event }) {
    if (context.principalId === state.integrationPrincipalId) return true;
    const separator = event.resource.indexOf(':');
    const type = event.resource.slice(0, separator);
    const id = event.resource.slice(separator + 1);
    if (type === 'sync') return !!memberOf(state, context.principalId);
    if (type === 'account') return !!visibleAccount(state, context.principalId, id);
    if (type === 'activity') {
      const activity = own(state.activities, id);
      return !!activity && !!visibleAccount(state, context.principalId, activity.accountId);
    }
    return false;
  },
};
