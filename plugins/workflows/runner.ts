import { ApplicationError, type OutputOf } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { PluginStartContext } from '@agent-native/host/plugin';
import { runIdOf, workflowOperations as ops } from './contracts';

type Due = OutputOf<typeof ops.due>['items'][number];

export interface Runner {
  readonly context: PluginStartContext;
  /** Journal cursors already checked for each waiting instance, kept in memory so an idle pass writes nothing. */
  readonly cursors: Map<string, number>;
}

/** The starter under the instance's grant and run ID: every step runs as them, narrowed. */
function asStarter(runner: Runner, item: Due): ExecutionContext {
  const { workspaceId } = runner.context;
  const runId = runIdOf(item.id);
  return {
    principalId: item.starter,
    workspaceId,
    runId,
    channel: 'host',
    grant: { ...item.grant, principalId: item.starter, workspaceId, runId },
  };
}

const failureOf = (error: unknown) =>
  error instanceof ApplicationError
    ? { code: error.code, message: error.message.slice(0, 500) }
    : { code: 'INTERNAL', message: 'The step failed' };

/**
 * Whether a resource of a watched type changed since the instance last checked. The journal is
 * read as the starter without the instance's grant, because the change that ends a wait is made
 * by operations outside it; the runner uses only the resource types it reads there.
 */
async function watchedChange(runner: Runner, item: Due) {
  const { types, cursor } = item.watch!;
  const after = Math.max(cursor, runner.cursors.get(item.id) ?? 0);
  const batch = await runner.context.application.events(after, {
    principalId: item.starter,
    workspaceId: runner.context.workspaceId,
    runId: runIdOf(item.id),
  });
  runner.cursors.set(item.id, batch.cursor);
  const changed =
    batch.reset || batch.events.some((event) => types.includes(event.resource.split(':')[0]!));
  return changed ? batch.cursor : undefined;
}

/**
 * Advance one instance by one step. The key names the instance and its `seq`, so an advance
 * repeated after a crash replays the stored receipt instead of running the step twice. A
 * failure rolls the step back with its record; the runner then records it under its own key.
 */
async function step(runner: Runner, item: Due, cursor: number | undefined) {
  const { application } = runner.context;
  const context = asStarter(runner, item);
  try {
    await application.invokeRaw(
      {
        operation: ops.advance.id,
        input: { id: item.id, seq: item.seq, ...(cursor === undefined ? {} : { cursor }) },
        idempotencyKey: `${runIdOf(item.id)}:${item.seq}`,
      },
      context,
    );
  } catch (error) {
    await application.invokeRaw(
      {
        operation: ops.fail.id,
        input: { id: item.id, seq: item.seq, ...failureOf(error) },
        idempotencyKey: `${runIdOf(item.id)}:${item.seq}:fail`,
      },
      context,
    );
  }
}

/** One pass: read what is due as the local owner, then advance each instance once. */
export async function passOnce(runner: Runner) {
  const { application, delegate, onError } = runner.context;
  const listed = await application.queryRaw(
    { operation: ops.due.id, input: {} },
    delegate({ operations: [ops.due.id] }),
  );
  for (const item of (listed.data as OutputOf<typeof ops.due>).items) {
    try {
      if (item.now) await step(runner, item, listed.cursor);
      else {
        const cursor = await watchedChange(runner, item);
        if (cursor !== undefined) await step(runner, item, cursor);
      }
    } catch (error) {
      onError(`Workflow ${item.id}`, error);
    }
  }
}

/** Pass every `intervalMs`; stopping waits for the running pass. */
export function startRunner(runner: Runner, intervalMs: number) {
  let running: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    running = running
      .then(() => passOnce(runner))
      .catch((error: unknown) => runner.context.onError('Workflows', error));
  }, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
