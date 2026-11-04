import { ApplicationError } from '@tortoise/contracts';
import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import type { CrmState } from '../domain';
import {
  accountRecords,
  activityRecords,
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
 * Commands that capture work locally and forward it to the CRM through the outbox: following an
 * account found by search, and logging an activity against a followed one. Neither calls the CRM;
 * both commit first and let the dispatcher deliver.
 */
export const captureHandlers = (): HandlerContribution<CrmState, CrmServices>[] => [
  handler(operations.accountFollow, (input, ctx) => {
    const accounts = accountRecords(ctx);
    const existing = accounts.get(input.externalId);
    // Requested or following already: nothing to ask the CRM again.
    if (existing && existing.status !== 'rejected')
      return { id: existing.id, status: existing.status };
    // The CRM checks the requester's access when it receives the follow request (effect.principalId).
    const effectId = ctx.enqueue({
      target: TARGET,
      type: 'account.follow',
      resource: accounts.resource(input.externalId),
      payload: { externalId: input.externalId },
    });
    accounts.set(
      input.externalId,
      {
        id: input.externalId,
        status: 'requested',
        effectId,
        followedBy: ctx.context.principalId,
        followedAt: now(ctx),
      },
      'followed',
    );
    return { id: input.externalId, status: 'requested' as const };
  }),
  handler(operations.activityLog, (input, ctx) => {
    const accounts = accountRecords(ctx);
    const account = accounts.getExisting(input.accountId);
    if (account.status !== 'following')
      throw new ApplicationError('CONFLICT', `Account is ${account.status}`, {
        status: account.status,
      });
    const at = now(ctx);
    if (input.occurredAt > at + MAX_CLOCK_SKEW_MS)
      invalid('occurredAt', 'Activity is in the future');
    if (input.occurredAt < at - MAX_AGE_MS) invalid('occurredAt', 'Activity is older than 7 days');
    const activities = activityRecords(ctx);
    const id = newId(ctx);
    const effectId = ctx.enqueue({
      target: TARGET,
      type: 'activity.create',
      resource: activities.resource(id),
      payload: {
        accountId: account.id,
        kind: input.kind,
        summary: input.summary,
        occurredAt: input.occurredAt,
      },
    });
    const activity = activities.insert(
      id,
      {
        id,
        ...input,
        recordedAt: at,
        recordedBy: ctx.context.principalId,
        effectId,
        sync: 'pending' as const,
      },
      'logged',
    );
    accounts.touch(account.id);
    const { effectId: _effectId, recordedAt: _recordedAt, ...visible } = activity;
    return visible;
  }),
];
