import { defineModule } from '@agent-native/contracts';
import { operations } from './contracts/operations';
import { crmAccounts, crmContacts } from './contracts/providers';

export { operations } from './contracts/operations';
export { crmAccounts, crmContacts } from './contracts/providers';
export {
  accountFoundSchema,
  contactFoundSchema,
  accountSchema,
  activitySchema,
  accountSnapshotSchema,
} from './contracts/schemas';

export const crmCaptureModule = defineModule({
  id: 'crm-capture',
  capabilities: [
    ...crmAccounts.capabilities,
    ...crmContacts.capabilities,
    ...Object.values(operations),
  ],
  requirements: {
    network: [
      {
        id: 'crm-api',
        purpose:
          'Search accounts and contacts live with the caller’s CRM access, follow adopted accounts, forward logged activities and pull followed accounts.',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        targets: ['crm'],
        reads: ['crm'],
        dataClasses: ['crm-search-query', 'crm-account', 'crm-activity'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
  workflows: [
    {
      id: 'find-and-log',
      operations: [
        'crm.account.search',
        'crm.contact.search',
        'crm.account.lookup',
        'crm.account.adopt',
        'crm.account.get',
        'crm.activity.log',
      ],
      text: 'Find the account with crm.account.search (or a contact with crm.contact.search, then its accountId). Results come live from the CRM and are not stored. Adopt the account with crm.account.adopt unless local already says following or adopted, then log the activity against it with crm.activity.log using the time from the source. If source.status is unavailable, use crm.account.list for accounts already adopted and say the CRM could not be searched; never invent CRM IDs.',
    },
    {
      id: 'review-sync',
      operations: ['crm.sync.status', 'crm.account.list', 'crm.account.get'],
      text: 'Read crm.sync.status, then list rejected accounts and open activities that were not accepted. Explain each rejection; do not retry by logging the same activity again.',
    },
  ],
});
