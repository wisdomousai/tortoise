import { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';
import {
  accountDetailSchema,
  accountSchema,
  accountSnapshotSchema,
  activitySchema,
  externalId,
  localStatus,
  outcomeSchema,
  timestamp,
} from './schemas';

const TARGET = 'crm';
const accountRead = { action: 'read', resourceType: 'CrmAccount' };

/** One local operation: description, UI binding, and the outbox target when it forwards. */
function operation<const Id extends string, const Kind extends 'command' | 'query', I, O>(
  id: Id,
  kind: Kind,
  spec: {
    input: z.ZodType<I>;
    output: z.ZodType<O>;
    permission: { action: string; resourceType: string };
    description: string;
    dependencies: readonly string[];
    forwards?: boolean;
    exception?: string;
  },
) {
  return defineCapability({
    id,
    kind,
    description: spec.description,
    input: jsonSchema(spec.input),
    output: jsonSchema(spec.output),
    permission: spec.permission,
    dependencies: spec.dependencies,
    ui: spec.exception ? { exception: spec.exception } : { binding: id },
    ...(spec.forwards ? { integration: { target: TARGET, delivery: 'outbox' as const } } : {}),
  });
}

/** Local reads, writes forwarded to the CRM, and the integration principal's feed. */
export const operations = {
  accountList: operation('crm.account.list', 'query', {
    input: z.strictObject({ status: localStatus.exclude(['none']).optional() }),
    output: z.strictObject({ items: z.array(accountSchema) }),
    permission: accountRead,
    description:
      'List accounts this workspace follows, in your regions: their status (following until the CRM feed delivers them, adopted, or rejected) and activity counts. Works while the CRM is unreachable.',
    dependencies: ['account', 'activity'],
  }),
  accountGet: operation('crm.account.get', 'query', {
    input: z.strictObject({ id: externalId }),
    output: accountDetailSchema,
    permission: accountRead,
    description:
      'Read one followed account with its activities and whether the CRM accepted each one.',
    dependencies: ['account', 'activity'],
  }),
  syncStatus: operation('crm.sync.status', 'query', {
    input: z.strictObject({}),
    output: z.strictObject({
      following: z.number().int(),
      adopted: z.number().int(),
      rejected: z.number().int(),
      pending: z.number().int(),
      lastSyncAt: timestamp.optional(),
      watermark: z.string().optional(),
    }),
    permission: { action: 'read', resourceType: 'CrmSync' },
    description:
      'Summarize synchronization with the CRM: accounts following, adopted and rejected, records waiting to be sent, and the last feed sync.',
    dependencies: ['account', 'activity', 'sync'],
  }),
  accountAdopt: operation('crm.account.adopt', 'command', {
    input: z.strictObject({ externalId }),
    output: z.strictObject({ id: externalId, status: localStatus.exclude(['none']) }),
    permission: { action: 'adopt', resourceType: 'CrmAccount' },
    description:
      'Bring a CRM account found with crm.account.search into this workspace. The CRM is asked to let you follow it (with your CRM access); its details then arrive through the CRM feed and stay current. The receipt proves the local request only: the account is following until then, or rejected if the CRM refuses. Adopting an account already followed returns it unchanged.',
    dependencies: ['account'],
    forwards: true,
  }),
  activityLog: operation('crm.activity.log', 'command', {
    input: z.strictObject({
      accountId: externalId,
      kind: z.enum(['call', 'meeting', 'note']),
      summary: z.string().min(1).max(2000),
      occurredAt: timestamp,
    }),
    output: activitySchema,
    permission: { action: 'log', resourceType: 'CrmAccount' },
    description:
      'Record a call, meeting or note against an adopted account (epoch ms occurredAt, at most 7 days old). It is saved here first and sent to the CRM, which accepts or rejects it later.',
    dependencies: ['account', 'activity'],
    forwards: true,
  }),
  accountSync: operation('crm.account.sync', 'command', {
    input: z.strictObject({
      from: z.string().optional(),
      to: z.string(),
      accounts: z.array(accountSnapshotSchema).max(500),
    }),
    output: z.strictObject({ watermark: z.string(), accounts: z.number().int() }),
    permission: { action: 'sync', resourceType: 'CrmSync' },
    description:
      'Integration principal only: apply CRM snapshots of followed accounts and advance the watermark. A stale from watermark conflicts.',
    dependencies: ['account', 'sync'],
    exception: 'integration principal; the CRM feed',
  }),
  effectSettle: operation('crm.effect.settle', 'command', {
    input: z.strictObject({ effectId: z.string(), outcome: outcomeSchema }),
    output: z.strictObject({ resource: z.string(), sync: z.enum(['accepted', 'rejected']) }),
    permission: { action: 'settle', resourceType: 'CrmSync' },
    description:
      'Integration principal only: record the CRM outcome for a follow request or a logged activity.',
    dependencies: ['account', 'activity'],
    exception: 'integration principal; the outbox dispatcher',
  }),
} as const;
