import type { OsNotifyAction } from '@agent-native/contracts';
import { createEffectDispatcher } from '@agent-native/integration';
import type { HostedApplication } from '@agent-native/kernel/application';
import type { PluginInstance, PluginOpenContext } from '@agent-native/kernel/plugin';
import { osServiceOf } from '@agent-native/os';
import { notificationOperations as ops } from './contracts';
import { createNotificationPort } from './deliver';
import type { NotificationsService } from './handlers';
import { replyConsumer } from './reply';

export interface NotificationsOptions {
  /** The instance clock, for reply expiry and delivery backoff. */
  readonly now?: () => number;
  /** How long a reply works after its notification was shown. Default one day. */
  readonly replyTtlMs?: number;
  /** How often each dispatcher looks for pending notifications. Default one second. */
  readonly deliverMs?: number;
}

/** The completion command of a target a notify action carries, checked by the catalog. */
export const completeOperationOf = (target: string) => `${target}.effect.complete`;

/**
 * Open the notifications plugin: enable notify actions and reply handlers in the OS plugin and
 * receive the replies that name it. Once started (on a serving host after it listens, on a phone
 * at each foreground) it runs one outbox dispatcher per target a queueing notify action carries,
 * as the owner narrowed to issuing replies and that target's completion command.
 */
export function openNotifications(options: NotificationsOptions = {}) {
  return async (context: PluginOpenContext): Promise<PluginInstance> => {
    const now = options.now ?? Date.now;
    const os = osServiceOf(context.services);
    os.enable({ handlers: ['reply'], actions: ['notify'] });
    let application: HostedApplication | undefined;
    os.consume(
      'notifications',
      replyConsumer(() => application),
    );
    const carried = (context.catalog.os?.actions ?? []).flatMap((action) =>
      action.kind === 'notify'
        ? (action.targets ?? []).map((target) => ({ target, action: action as OsNotifyAction }))
        : [],
    );
    const service: NotificationsService = { now, replyTtlMs: options.replyTtlMs ?? 86_400_000 };
    return {
      service,
      ready: async (hosted) => {
        application = hosted;
      },
      async start(started) {
        return carried.map(({ target, action }) => {
          const caller = started.delegate({
            operations: [completeOperationOf(target), ops.issue.id],
          });
          const dispatcher = createEffectDispatcher({
            application: started.application,
            port: createNotificationPort({
              target,
              action,
              os,
              application: started.application,
              context: caller,
            }),
            context: caller,
            completeOperation: completeOperationOf(target),
            // The target's complete command is fenced, as a `defineTarget` complete is.
            completeInput: (effect, outcome, attempt) => ({
              effectId: effect.id,
              outcome,
              fence: attempt.fence,
            }),
            now,
          });
          dispatcher.start(options.deliverMs ?? 1_000);
          return { stop: () => dispatcher.stop() };
        });
      },
      describe: () => ({ targets: carried.map(({ target }) => target) }),
    };
  };
}
