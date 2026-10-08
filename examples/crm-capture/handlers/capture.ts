import { ApplicationError } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { own, put, type CrmState } from '../domain';
import {
  accountOf,
  handler,
  invalid,
  MAX_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  newId,
  now,
  TARGET,
  type CrmServices,
} from './context';

/**
 * Commands that capture work locally and forward it to the CRM through the outbox: adopting an
 * account found by search, and logging an activity against an adopted one. Neither calls the CRM;
 * both commit first and let the dispatcher deliver.
 */
export const captureHandlers = (): HandlerContribution<CrmState, CrmServices>[] => [
  handler(operations.accountAdopt, (input, ctx) => {
    const existing = own(ctx.state.accounts, input.externalId);
    // Following or adopted already: nothing to ask the CRM again.
    if (existing && existing.status !== 'rejected')
      return { id: existing.id, status: existing.status };
    // The CRM checks the requester's access when it receives the follow request (effect.principalId).
    const effectId = ctx.enqueue({
      target: TARGET,
      type: 'account.follow',
      resource: `account:${input.externalId}`,
      payload: { externalId: input.externalId },
    });
    put(ctx.state.accounts, input.externalId, {
      id: input.externalId,
      status: 'following',
      effectId,
      adoptedBy: ctx.context.principalId,
      adoptedAt: now(ctx),
    });
    ctx.change(`account:${input.externalId}`, 'adopted');
    return { id: input.externalId, status: 'following' as const };
  }),
  handler(operations.activityLog, (input, ctx) => {
    const account = accountOf(ctx.state, input.accountId);
    if (account.status !== 'adopted')
      throw new ApplicationError('CONFLICT', `Account is ${account.status}`, {
        status: account.status,
      });
    const at = now(ctx);
    if (input.occurredAt > at + MAX_CLOCK_SKEW_MS)
      invalid('occurredAt', 'Activity is in the future');
    if (input.occurredAt < at - MAX_AGE_MS) invalid('occurredAt', 'Activity is older than 7 days');
    const id = newId(ctx);
    const effectId = ctx.enqueue({
      target: TARGET,
      type: 'activity.create',
      resource: `activity:${id}`,
      payload: {
        accountId: account.id,
        kind: input.kind,
        summary: input.summary,
        occurredAt: input.occurredAt,
      },
    });
    const activity = {
      id,
      ...input,
      recordedAt: at,
      recordedBy: ctx.context.principalId,
      effectId,
      sync: 'pending' as const,
    };
    put(ctx.state.activities, id, activity);
    ctx.change(`activity:${id}`, 'logged');
    ctx.change(`account:${account.id}`);
    const { effectId: _effectId, recordedAt: _recordedAt, ...visible } = activity;
    return visible;
  }),
];
