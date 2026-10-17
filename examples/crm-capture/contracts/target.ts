import { z } from 'zod';
import { defineTarget } from '@agent-native/contracts';
import { accountSnapshotSchema } from './schemas';

/**
 * The CRM as a system of record: follow requests and activities are forwarded to it, and its feed
 * delivers the accounts this workspace follows.
 */
export const crmTarget = defineTarget({
  target: 'crm',
  resourceType: 'CrmSync',
  operations: { settle: 'crm.effect.settle', sync: 'crm.account.sync', status: 'crm.sync.status' },
  settles: ['account', 'activity'],
  feed: { item: accountSnapshotSchema, max: 500, changes: ['account'] },
  status: {
    following: z.number().int(),
    adopted: z.number().int(),
    rejected: z.number().int(),
    pending: z.number().int(),
  },
  descriptions: {
    settle:
      'Integration principal only: record the CRM outcome for a follow request or a logged activity.',
    sync: 'Integration principal only: apply CRM snapshots of followed accounts and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize synchronization with the CRM: accounts following, adopted and rejected, records waiting to be sent, and the last feed sync.',
  },
});
