import { z } from 'zod';
import { collectionList, defineCapability, jsonSchema } from '@agent-native/contracts';
import { accounts } from './collections';
import { crmTarget } from './target';
import { accountDetailSchema, activitySchema, externalId, localStatus, timestamp } from './schemas';

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
  accountList: collectionList(accounts, {
    id: 'crm.account',
    filters: ['status'],
    description:
      'List accounts this workspace follows, in your regions, newest first: their status (following until the CRM feed delivers them, adopted, or rejected) and activity counts. total counts every match in your regions; page with offset and limit. Works while the CRM is unreachable.',
    dependencies: ['activity'],
  }),
  accountGet: operation('crm.account.get', 'query', {
    input: z.strictObject({ id: externalId }),
    output: accountDetailSchema,
    permission: accountRead,
    description:
      'Read one followed account with its activities and whether the CRM accepted each one.',
    dependencies: ['account', 'activity'],
  }),
  syncStatus: crmTarget.status,
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
  accountSync: crmTarget.sync,
  effectSettle: crmTarget.settle,
} as const;
