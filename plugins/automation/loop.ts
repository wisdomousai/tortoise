import type { Catalog } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { PluginStartContext } from '@agent-native/host/plugin';
import { automationOperations as ops, type TriggerDefinition } from './contracts';
import type { TriggerEvent } from './jobs';
import { eventRunId, loopRunId, slotRunId } from './run-ids';
import { runContext, type Grant, type RunOutcome } from './run';
import type { ResolvedTrigger } from './triggers';

type Summary = { grant?: Grant; cursor?: number; slot?: number; id: string };
type Run = (
  trigger: ResolvedTrigger,
  context: ExecutionContext,
  start: { event?: TriggerEvent; slot?: number },
) => Promise<RunOutcome>;

export interface Loop {
  readonly context: PluginStartContext;
  readonly catalog: Catalog;
  readonly triggers: ReadonlyMap<string, ResolvedTrigger>;
  readonly run: Run;
  readonly now: () => number;
  /** Cursors past events no trigger matched, kept in memory so the loop does not write per pass. */
  readonly cursors: Map<string, number>;
}

/** The grant issuer narrowed to `operations`, under the grant's loop run ID. */
function asIssuer(loop: Loop, grant: Grant, operations: readonly string[]): ExecutionContext {
  const runId = loopRunId(grant.id);
  const { workspaceId } = loop.context;
  return {
    principalId: grant.issuedBy,
    workspaceId,
    runId,
    channel: 'host',
    grant: { operations: [...operations], principalId: grant.issuedBy, workspaceId, runId },
  };
}

/** Record progress as the issuer. The key names the position, so a repeat after a crash replays. */
async function record(
  loop: Loop,
  grant: Grant,
  key: string,
  input: { cursor?: number; slot?: number; run?: RunOutcome },
) {
  const { run, ...position } = input;
  await loop.context.application.invokeRaw(
    {
      operation: ops.progressRecord.id,
      input: {
        grant: grant.id,
        ...position,
        ...(run ? { run: { ...run } } : {}),
      },
      idempotencyKey: `${loopRunId(grant.id)}:${key}`,
    },
    asIssuer(loop, grant, [ops.progressRecord.id]),
  );
}

/** The trigger's grant if it is still the active one; a revoked or replaced grant stops here. */
async function stillActive(loop: Loop, trigger: string, grant: Grant) {
  const { data } = await loop.context.application.queryRaw(
    { operation: ops.triggerList.id, input: {} },
    loop.context.delegate({ operations: [ops.triggerList.id] }),
  );
  return (
    (data as { items: Summary[] }).items.find((item) => item.id === trigger)?.grant?.id === grant.id
  );
}

const matches = (
  on: Extract<TriggerDefinition['on'], { event: unknown }>['event'],
  event: TriggerEvent,
) =>
  event.resource.startsWith(`${on.resourceType}:`) &&
  on.operations.includes(event.operation) &&
  (!on.types || on.types.includes(event.type));

/**
 * One pass over an event trigger: read the journal as the issuer narrowed to the operations it
 * reacts to, run once per matching event in order and record each before the next. A grant seen
 * for the first time starts at the snapshot that listed it, not at the start of the journal.
 */
async function eventPass(loop: Loop, trigger: ResolvedTrigger, summary: Summary, listedAt: number) {
  const grant = summary.grant!;
  const on = (trigger.on as Extract<TriggerDefinition['on'], { event: unknown }>).event;
  const persisted = summary.cursor;
  if (persisted === undefined)
    return record(loop, grant, `start:${listedAt}`, { cursor: listedAt });
  const cursor = Math.max(persisted, loop.cursors.get(grant.id) ?? 0);
  const batch = await loop.context.application.events(cursor, asIssuer(loop, grant, on.operations));
  for (const event of batch.events) {
    if (!matches(on, event)) continue;
    if (!(await stillActive(loop, trigger.id, grant))) return;
    const id = eventRunId(grant.id, event.cursor);
    const context = runContext(loop.catalog, trigger, grant, {
      id,
      workspaceId: loop.context.workspaceId,
      now: loop.now(),
      resource: event.resource,
    });
    const outcome = await loop.run(trigger, context, { event: { ...event } });
    await record(loop, grant, `event:${event.cursor}`, { cursor: event.cursor, run: outcome });
  }
  loop.cursors.set(grant.id, batch.cursor);
}

/** One pass over a schedule trigger: run once when a new slot began, starting with the next one. */
async function schedulePass(loop: Loop, trigger: ResolvedTrigger, summary: Summary) {
  const grant = summary.grant!;
  const { everyMs } = (trigger.on as { schedule: { everyMs: number } }).schedule;
  const slot = Math.floor(loop.now() / everyMs);
  if (summary.slot === undefined) return record(loop, grant, `start:${slot}`, { slot });
  if (slot <= summary.slot) return;
  const id = slotRunId(grant.id, slot);
  const context = runContext(loop.catalog, trigger, grant, {
    id,
    workspaceId: loop.context.workspaceId,
    now: loop.now(),
  });
  const outcome = await loop.run(trigger, context, { slot });
  await record(loop, grant, `slot:${slot}`, { slot, run: outcome });
}

/** One pass over every trigger that has an active grant. A trigger's error never stops another. */
export async function passOnce(loop: Loop) {
  const listed = await loop.context.application.queryRaw(
    { operation: ops.triggerList.id, input: {} },
    loop.context.delegate({ operations: [ops.triggerList.id] }),
  );
  for (const summary of (listed.data as { items: Summary[] }).items) {
    const trigger = loop.triggers.get(summary.id);
    if (!summary.grant || !trigger) continue;
    try {
      if ('event' in trigger.on) await eventPass(loop, trigger, summary, listed.cursor);
      else await schedulePass(loop, trigger, summary);
    } catch (error) {
      loop.context.onError(`Trigger ${trigger.id}`, error);
    }
  }
}

/** Pass every `intervalMs`; stopping waits for the running pass. */
export function startLoop(loop: Loop, intervalMs: number) {
  let running: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    running = running
      .then(() => passOnce(loop))
      .catch((error: unknown) => loop.context.onError('Automation', error));
  }, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
