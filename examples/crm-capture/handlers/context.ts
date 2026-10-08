import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { own, type CrmState, type LocalAccount } from '../domain';

export interface CrmServices {
  newId?: () => string;
  /** Authority clock for adoption, recording and occurredAt bounds. */
  now?: () => number;
}
export type Context = HandlerContext<CrmState, CrmServices>;

export const TARGET = 'crm';
/** An activity older than this belongs in the CRM's own history import. */
export const MAX_AGE_MS = 7 * 24 * 3_600_000;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
export const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();

/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
export function invalid(field: string, message: string): never {
  throw new ApplicationError('INVALID_INPUT', message, { field });
}

/** An account as callers see it, with how many activities were logged against it. */
export function accountDto(state: CrmState, account: LocalAccount) {
  const { effectId: _effectId, ...visible } = account;
  const activities = Object.values(state.activities).filter(
    (activity) => activity.accountId === account.id,
  ).length;
  return compact({ ...visible, activities });
}
export const accountOf = (state: CrmState, id: string) => {
  const account = own(state.accounts, id);
  if (!account) throw new ApplicationError('NOT_FOUND', 'Account unavailable');
  return account;
};

export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<CrmState, CrmServices, C> {
  return { capability, handle };
}
