import { ApplicationError } from '@agent-native/contracts';
import type { HostedApplication } from '@agent-native/kernel/application';
import type { OsConsumer } from '@agent-native/os';
import type { ExecutionContext } from '@agent-native/runtime';
import { notificationOperations as ops } from './contracts';
import { digestOf } from './state';

/** The replying caller on the shell channel, narrowed to `operations` within its own grant. */
function narrowed(context: ExecutionContext, operations: readonly string[]): ExecutionContext {
  const allowed = context.grant
    ? operations.filter((operation) => context.grant!.operations.includes(operation))
    : operations;
  return {
    ...context,
    channel: 'shell',
    grant: { ...(context.grant ?? {}), operations: allowed },
  };
}

/**
 * The receiver of the reply handlers that name this plugin. A reply is an OS request like any
 * other: whoever can submit to the shell can send one, with any nonce. It runs as the session
 * that submitted it: the lookup answers only for a live nonce issued to that principal, and the
 * redemption runs under a grant of exactly the redeem command and the one continuation it
 * found, keyed by the nonce's digest so a repeated reply commits once. An unknown, used or
 * expired nonce, or a continuation the caller may not run, changes nothing.
 */
export function replyConsumer(application: () => HostedApplication | undefined): OsConsumer {
  return async (context, _match, raw) => {
    const hosted = application();
    if (raw.kind !== 'reply' || !hosted) return;
    const digest = digestOf(raw.nonce);
    try {
      const found = await hosted.queryRaw(
        { operation: ops.replyGet.id, input: { digest } },
        narrowed(context, [ops.replyGet.id]),
      );
      const operation = (found.data as { operation: string | null }).operation;
      if (!operation) return;
      await hosted.invokeRaw(
        {
          operation: ops.redeem.id,
          input: { nonce: raw.nonce, button: raw.action, handler: raw.handler },
          idempotencyKey: `reply:${digest}`,
        },
        narrowed(context, [ops.redeem.id, operation]),
      );
    } catch (error) {
      // A refusal is the answer to an untrusted request; the runtime already audited it.
      if (error instanceof ApplicationError) return;
      throw error;
    }
  };
}
