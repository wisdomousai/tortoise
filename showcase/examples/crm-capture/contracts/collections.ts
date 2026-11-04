import { defineCollection } from '@tortoise/contracts';
import { accountSchema, activitySchema } from './schemas';

/** Accounts this workspace follows, keyed by CRM ID, as callers see them. */
export const accounts = defineCollection({
  type: 'account',
  resourceType: 'CrmAccount',
  item: accountSchema,
  label: { one: 'Account', many: 'Accounts' },
});
/** Activities logged here against a followed account, each forwarded to the CRM. */
export const activities = defineCollection({
  type: 'activity',
  resourceType: 'CrmAccount',
  item: activitySchema,
  label: { one: 'Activity', many: 'Activities' },
});
