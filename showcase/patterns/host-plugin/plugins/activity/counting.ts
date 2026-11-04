import type { PluginStartContext } from '@tortoise/host/plugin';
import type { ExecutionContext } from '@tortoise/runtime';
import { activityOperations } from './contracts';

const summaryOperation = activityOperations.summaryGet.id;
const recordOperation = activityOperations.passRecord.id;

interface Loop {
  readonly context: PluginStartContext;
  readonly caller: ExecutionContext;
  cursor: number;
}

/**
 * One pass: read the journal after the cursor and record the commands per operation. The grant
 * lists only the counted operations, so the journal returns only their entries. When retention
 * removed entries before they were read, the pass counts what is left, and the counts are a lower
 * bound from then on.
 */
async function countOnce(loop: Loop) {
  const { application } = loop.context;
  const batch = await application.events(loop.cursor, loop.caller);
  const counts = new Map<string, number>();
  for (const event of batch.events)
    if (event.operation !== recordOperation)
      counts.set(event.operation, (counts.get(event.operation) ?? 0) + 1);
  if (!counts.size) {
    loop.cursor = batch.cursor;
    return;
  }
  const commandResult = await application.invokeRaw(
    {
      operation: recordOperation,
      input: {
        cursor: batch.cursor,
        counted: [...counts].map(([operation, count]) => ({ operation, count })),
      },
    },
    loop.caller,
  );
  // Past this pass's own record, so the next pass does not read it again.
  loop.cursor = commandResult.cursor;
}

/**
 * Count committed commands every `intervalMs` as the local user narrowed to a grant that lists
 * the counted operations and this plugin's own two. It resumes from the recorded cursor after a
 * restart. Stops after the running pass.
 */
export async function startCounting(
  context: PluginStartContext,
  operations: readonly string[],
  intervalMs = 1_000,
) {
  const caller = context.delegate({
    operations: [...operations, summaryOperation, recordOperation],
  });
  const summary = await context.application.queryRaw(
    { operation: summaryOperation, input: {} },
    caller,
  );
  const loop: Loop = { context, caller, cursor: (summary.data as { cursor: number }).cursor };
  let running: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    running = running
      .then(() => countOnce(loop))
      .catch((error: unknown) => context.onError('Activity count', error));
  }, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
