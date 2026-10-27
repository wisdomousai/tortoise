import { z } from 'zod';
import type {
  JsonValue,
  OsActionOutcome,
  OsNotificationButton,
  OsNotifyAction,
} from '@agent-native/contracts';
import { DeliveryFailure, type SystemOfRecordPort } from '@agent-native/integration';
import type { OsService } from '@agent-native/os';
import type { Effect, EffectOutcome, ExecutionContext } from '@agent-native/runtime';
import { notificationOperations as ops } from './contracts';
import { digestOf, newNonce } from './state';

interface IssuedReply {
  digest: string;
  button: string;
  handler: string;
  operation: string;
  input: Record<string, JsonValue>;
}

/** `OsNotificationPayload` as the dispatcher accepts it from a committed effect. */
const payloadSchema = z.strictObject({
  principal: z.string().min(1).max(200),
  category: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
  replies: z
    .record(
      z.string(),
      z.strictObject({
        operation: z.string().min(1).max(200),
        input: z.record(z.string(), z.json()),
      }),
    )
    .optional(),
});

const rejected = (code: string, message: string): EffectOutcome => ({
  status: 'rejected',
  code,
  message,
});

/** Refusals that will not change by trying again: the effect is completed as rejected. */
const final: Partial<Record<string, string>> = {
  'no-handler': 'The notify action is not declared',
  disabled: 'The site turned this notification off',
  invalid: 'The notification is invalid',
};

export interface NotificationPortOptions {
  readonly target: string;
  readonly action: OsNotifyAction;
  readonly os: OsService;
  readonly application: {
    invokeRaw(
      request: { operation: string; input: unknown; idempotencyKey?: string },
      context: ExecutionContext,
    ): Promise<unknown>;
  };
  /** The dispatcher's identity: the owner narrowed to issuing and the target's completion. */
  readonly context: ExecutionContext;
}

/** What one delivery shows, with the replies to record first; or why the effect is rejected. */
function prepare(
  effect: Readonly<Effect>,
  action: OsNotifyAction,
):
  | EffectOutcome
  | {
      payload: z.output<typeof payloadSchema>;
      buttons: OsNotificationButton[];
      replies: IssuedReply[];
    } {
  const parsed = payloadSchema.safeParse(effect.payload);
  if (!parsed.success) return rejected('INVALID_PAYLOAD', 'The notification payload is invalid');
  const payload = parsed.data;
  const category = action.categories.find((item) => item.id === payload.category);
  if (!category) return rejected('UNKNOWN_CATEGORY', `${action.id} has no such category`);
  const buttons: OsNotificationButton[] = [];
  const replies: IssuedReply[] = [];
  for (const [id, continuation] of Object.entries(payload.replies ?? {})) {
    const button = category.actions.find((item) => item.id === id);
    if (!button) return rejected('UNKNOWN_BUTTON', `${category.id} has no action ${id}`);
    const nonce = newNonce();
    buttons.push({
      id,
      title: button.title,
      handler: button.reply,
      nonce,
      ...(button.requiresUnlock ? { requiresUnlock: true } : {}),
    });
    replies.push({
      digest: digestOf(nonce),
      button: id,
      handler: button.reply,
      operation: continuation.operation,
      input: continuation.input as Record<string, JsonValue>,
    });
  }
  return { payload, buttons, replies };
}

/** Map what the OS plugin returned to the effect's outcome, or throw to try again later. */
function completed(outcome: OsActionOutcome): EffectOutcome {
  if (outcome.status === 'performed') return { status: 'accepted' };
  if (outcome.status === 'refused') {
    const message = final[outcome.reason];
    if (message)
      return rejected(`NOTIFICATION_${outcome.reason.toUpperCase().replace('-', '_')}`, message);
    // Unattached, rate-limited or failed: the effect stays queued and is shown later.
    throw new DeliveryFailure(`The notification was not shown: ${outcome.reason}`);
  }
  throw new DeliveryFailure('The notification was not shown');
}

/**
 * The outbox port of one target a queueing `notify` action carries. Delivering an effect checks
 * its payload against the action's categories, records fresh reply nonces by digest through
 * `notification.issue`, then shows the notification through the adapter attached for the
 * notified principal. Without one it throws, so the effect stays pending until an adapter
 * attaches. The effect id is the notification id, so a repeated delivery replaces the earlier
 * notification instead of adding one, which makes delivery idempotent.
 */
export function createNotificationPort(options: NotificationPortOptions): SystemOfRecordPort {
  const { action, os, application, context } = options;
  return {
    describe: () => ({ target: options.target, idempotentDelivery: true }),
    async deliver(effect) {
      const prepared = prepare(effect, action);
      if ('status' in prepared) return prepared;
      const { payload, buttons, replies } = prepared;
      const notified = { workspaceId: context.workspaceId, principalId: payload.principal };
      // Checked first so a missing adapter does not write new nonces on every retry.
      if (!os.attached(notified))
        throw new DeliveryFailure('No adapter is attached to show the notification');
      await application.invokeRaw(
        {
          operation: ops.issue.id,
          input: { effectId: effect.id, principal: payload.principal, action: action.id, replies },
          idempotencyKey: `issue:${effect.id}:${replies[0]?.digest ?? newNonce()}`,
        },
        context,
      );
      return completed(
        await os.relay(notified, {
          kind: 'notify',
          action: action.id,
          id: effect.id,
          category: payload.category,
          title: payload.title,
          ...(payload.body ? { body: payload.body } : {}),
          ...(buttons.length ? { buttons } : {}),
        }),
      );
    },
  };
}
