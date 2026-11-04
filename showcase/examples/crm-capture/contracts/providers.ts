import { defineDataProvider } from '@tortoise/contracts';
import { accountFoundSchema, contactFoundSchema, searchInput } from './schemas';

/**
 * CRM accounts, searched live in the CRM with the caller's own access. A person without a CRM
 * login falls back to the integration's service account, and then sees only their regions.
 */
export const crmAccounts = defineDataProvider({
  id: 'crm.account',
  target: 'crm',
  identity: 'caller-or-service',
  resourceType: 'CrmAccount',
  query: searchInput,
  item: accountFoundSchema,
  descriptions: {
    search:
      'Search accounts in the CRM by name, city or industry, live, with your CRM access. Results are not stored: each carries source.fetchedAt, and local says whether this workspace already follows it. source.status unavailable means the CRM did not respond; fall back to crm.account.list. Follow a result with crm.account.follow before logging activities.',
    lookup:
      'Read one CRM account by its CRM ID (externalId), live, with your CRM access. An empty items list means the account does not exist or you cannot see it.',
  },
  ui: {
    lookup: { exception: 'agents resolve a CRM ID they were given; people pick from search' },
  },
});

/** CRM contacts, searched live; a contact leads to its account. */
export const crmContacts = defineDataProvider({
  id: 'crm.contact',
  target: 'crm',
  identity: 'caller-or-service',
  resourceType: 'CrmContact',
  query: searchInput,
  item: contactFoundSchema,
  descriptions: {
    search:
      'Search contacts in the CRM by name, title or email, live, with your CRM access. Each contact names its account (accountId); follow that account to log activities against it.',
    lookup: 'Read one CRM contact by its CRM ID (externalId), live, with your CRM access.',
  },
  ui: {
    lookup: { exception: 'agents resolve a CRM ID they were given; people pick from search' },
  },
});
