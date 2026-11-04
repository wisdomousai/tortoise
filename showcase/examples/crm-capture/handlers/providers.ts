import { z } from 'zod';
import { implementDataProvider } from '@tortoise/integration';
import { own } from '@tortoise/runtime';
import { crmAccounts, crmContacts } from '../contracts';
import { coversRegion, type CrmState } from '../domain';
import type { Context, CrmServices } from './context';

/**
 * What the CRM port returns, already mapped from the CRM's own field names. Parsed here because
 * a source is outside this application's trust: a malformed record is dropped, not shown.
 */
const accountRecord = z.object({
  externalId: z.string(),
  name: z.string(),
  industry: z.string(),
  city: z.string(),
  region: z.string(),
  owner: z.string(),
});
const contactRecord = z.object({
  externalId: z.string(),
  name: z.string(),
  title: z.string(),
  email: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  region: z.string(),
});

/** What this workspace holds of a CRM account, at the moment the result is assembled. */
const localOf = (ctx: Context, accountId: string) =>
  own(ctx.state.accounts, accountId)?.status ?? 'none';

/**
 * The two live providers. Rows outside the caller's regions are dropped before the result is
 * built, whichever credential the CRM saw: with a person's own login the CRM's sharing rules
 * already applied, and with the service account this is the only filter.
 */
export const providerHandlers = () => [
  ...implementDataProvider<CrmState, CrmServices, typeof crmAccounts>(crmAccounts, {
    item(found, ctx) {
      const record = accountRecord.safeParse(found);
      if (!record.success || !coversRegion(ctx.state, ctx.context.principalId, record.data.region))
        return undefined;
      return { ...record.data, local: localOf(ctx, record.data.externalId) };
    },
  }),
  ...implementDataProvider<CrmState, CrmServices, typeof crmContacts>(crmContacts, {
    item(found, ctx) {
      const record = contactRecord.safeParse(found);
      if (!record.success || !coversRegion(ctx.state, ctx.context.principalId, record.data.region))
        return undefined;
      return { ...record.data, local: localOf(ctx, record.data.accountId) };
    },
  }),
];
