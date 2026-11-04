import { z } from 'zod';
import { defineTarget } from '@tortoise/contracts';
import { accountSnapshotSchema } from './schemas';

/**
 * The CRM as a system of record: follow requests and activities are forwarded to it, and its inbound sync
 * delivers the accounts this workspace follows.
 */
export const crmTarget = defineTarget({
  target: 'crm',
  resourceType: 'CrmSync',
  operations: {
    complete: 'crm.effect.complete',
    sync: 'crm.account.sync',
    status: 'crm.sync.status',
  },
  changes: ['account', 'activity'],
  inbound: { item: accountSnapshotSchema, max: 500, changes: ['account'] },
  status: {
    requested: z.number().int(),
    following: z.number().int(),
    rejected: z.number().int(),
    pending: z.number().int(),
  },
  descriptions: {
    complete:
      'Integration principal only: record the CRM outcome for a follow request or a logged activity.',
    sync: 'Integration principal only: apply CRM snapshots of followed accounts and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize synchronization with the CRM: accounts requested, following and rejected, records waiting to be sent, and the last inbound sync.',
  },
});
