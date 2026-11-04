import { errorEnvelope } from '@tortoise/contracts';
import type { PluginStartContext } from '@tortoise/host/plugin';
import type { ExecutionContext } from '@tortoise/runtime';
import { webhookOperations } from './contracts';

const statusOperation = webhookOperations.statusGet.id;
const recordOperation = webhookOperations.deliveryRecord.id;

interface Loop {
  readonly context: PluginStartContext;
  readonly caller: ExecutionContext;
  readonly observing: ReadonlySet<string>;
  cursor: number;
  /** Last error recorded, so a lasting outage is recorded once rather than every pass. */
  lastError?: string;
}

/**
 * One pass: read the journal after the cursor, post the observed changes, record the outcome.
 * The journal holds only resource ids, revisions and operation names, never business data.
 * Delivery is at least once: a crash between the post and the record repeats the post.
 */
async function deliverOnce(loop: Loop) {
  const { application, ports } = loop.context;
  const batch = await application.events(loop.cursor, loop.caller);
  // Retention removed entries this loop never posted; posting the rest would hide the gap.
  if (batch.reset) {
    await application.invokeRaw(
      {
        operation: recordOperation,
        input: { delivered: 0, error: 'Journal entries were removed before they were posted' },
      },
      loop.caller,
    );
    loop.cursor = batch.cursor;
    return;
  }
  const changes = batch.events.filter((event) => loop.observing.has(event.operation));
  if (!changes.length) {
    // Nothing to post; skip unobserved entries (including this loop's own records) in memory.
    loop.cursor = batch.cursor;
    return;
  }
  try {
    const response = await ports.network.client('webhook-target').fetch('', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
  } catch (error) {
    const message = errorEnvelope(error).message.slice(0, 500);
    if (message !== loop.lastError) {
      loop.lastError = message;
      await application.invokeRaw(
        { operation: recordOperation, input: { delivered: 0, error: message } },
        loop.caller,
      );
    }
    return;
  }
  const commandResult = await application.invokeRaw(
    { operation: recordOperation, input: { cursor: batch.cursor, delivered: changes.length } },
    loop.caller,
  );
  delete loop.lastError;
  // Past this pass's own record, so the next pass does not read it again.
  loop.cursor = commandResult.cursor;
}

/**
 * Post observed changes every `intervalMs` as the local user narrowed to a grant that lists
 * only the observed operations and this plugin's own two. The grant also filters the journal,
 * so the loop never sees other operations' events. Stops after the running pass.
 */
export async function startDelivery(
  context: PluginStartContext,
  observing: readonly string[],
  intervalMs = 1_000,
) {
  const caller = context.delegate({ operations: [...observing, statusOperation, recordOperation] });
  const status = await context.application.queryRaw(
    { operation: statusOperation, input: {} },
    caller,
  );
  const loop: Loop = {
    context,
    caller,
    observing: new Set(observing),
    cursor: (status.data as { cursor: number }).cursor,
  };
  let running: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    running = running
      .then(() => deliverOnce(loop))
      .catch((error: unknown) => context.onError('Webhook delivery', error));
  }, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
