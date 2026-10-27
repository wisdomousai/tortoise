import { ApplicationError, type InputOf } from '@agent-native/contracts';
import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { notificationsModule, notificationOperations as ops } from './contracts';
import { digestOf, type NotificationsState } from './state';

/** What the plugin hands its handlers: the instance clock and how long a reply stays live. */
export interface NotificationsService {
  readonly now: () => number;
  readonly replyTtlMs: number;
}
export interface NotificationsServices {
  readonly notifications?: NotificationsService;
}

type Context = HandlerContext<NotificationsState, NotificationsServices>;

function serviceOf(ctx: Context): NotificationsService {
  const service = ctx.services.notifications;
  if (!service) throw new ApplicationError('UNAVAILABLE', 'Notifications are not open');
  return service;
}

/** Drop every reply of `effectId`, and expired replies of any notification. */
function prune(ctx: Context, at: number, effectId?: string) {
  const dropped = new Set<string>();
  for (const [digest, reply] of Object.entries(ctx.state.replies))
    if (reply.effectId === effectId || reply.expiresAt <= at) {
      delete ctx.state.replies[digest];
      dropped.add(reply.effectId);
    }
  for (const effect of dropped)
    ctx.change(`notification:${effect}`, 'notification.replies.dropped');
}

function issue(input: InputOf<typeof ops.issue>, ctx: Context) {
  const { now, replyTtlMs } = serviceOf(ctx);
  const at = now();
  // A retried delivery issues new nonces; the earlier attempt's never reached a person.
  prune(ctx, at, input.effectId);
  const expiresAt = at + replyTtlMs;
  for (const reply of input.replies) {
    if (Object.hasOwn(ctx.state.replies, reply.digest))
      throw new ApplicationError('CONFLICT', 'Nonce already issued');
    ctx.state.replies[reply.digest] = {
      effectId: input.effectId,
      principal: input.principal,
      action: input.action,
      button: reply.button,
      handler: reply.handler,
      operation: reply.operation,
      input: reply.input,
      expiresAt,
    };
  }
  ctx.change(`notification:${input.effectId}`, 'notification.issued');
  return { expiresAt };
}

/** A live reply issued to the caller, or undefined; one result for every failure. */
function liveReply(ctx: Context, digest: string) {
  const reply = Object.hasOwn(ctx.state.replies, digest) ? ctx.state.replies[digest] : undefined;
  if (!reply || reply.principal !== ctx.context.principalId) return undefined;
  return reply.expiresAt > serviceOf(ctx).now() ? reply : undefined;
}

function redeem(input: InputOf<typeof ops.redeem>, ctx: Context) {
  const reply = liveReply(ctx, digestOf(input.nonce));
  if (!reply || reply.button !== input.button || reply.handler !== input.handler)
    throw new ApplicationError('FORBIDDEN', 'Reply is invalid, expired or already used');
  // One choice per notification: every other button of it stops working with this one.
  prune(ctx, serviceOf(ctx).now(), reply.effectId);
  // The continuation runs as the replying caller through the whole pipeline, after this handler,
  // in this transaction: its authorization is checked now, not when the notification was issued.
  ctx.continueWith(reply.operation, reply.input);
  return { operation: reply.operation };
}

export const notificationsHandlers: HandlerContribution<
  NotificationsState,
  NotificationsServices
>[] = [
  { capability: ops.issue, handle: async (input, ctx) => issue(input as never, ctx) },
  {
    capability: ops.replyGet,
    handle: async (input, ctx) => ({
      operation: liveReply(ctx, (input as { digest: string }).digest)?.operation ?? null,
    }),
  },
  { capability: ops.redeem, handle: async (input, ctx) => redeem(input as never, ctx) },
];

const known = new Set<string>(notificationsModule.capabilities.map((capability) => capability.id));

/**
 * Issuing is for the owner acting under a delegated grant: the dispatcher. Looking up and
 * redeeming a reply is for any principal, but only on the shell channel, which the reply consumer
 * sets and no transport does; the handlers then act only on replies issued to the caller.
 * Notification events are visible to the owner.
 */
export const notificationsPolicy: AuthorizationPort<NotificationsState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (capability.id === ops.issue.id)
      return {
        allowed: context.principalId === state.owner && context.grant !== undefined,
        reason: 'RESOURCE_DENIED',
      };
    return { allowed: context.channel === 'shell', reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ context, state }) => context.principalId === state.owner,
};
