import { ApplicationError } from '@agent-native/contracts';
import type { EventBatch, ExecutionContext, WorkspaceSnapshot } from '../types.js';
import { grantPermits } from './delegation.js';
import type { Kernel } from './kernel.js';

/** Journal entries after a cursor that the grant and the read policy let this context see. */
async function eventBatch<State, Services>(
  kernel: Kernel<State, Services>,
  snapshot: Readonly<WorkspaceSnapshot<State>>,
  after: number,
  context: ExecutionContext,
): Promise<EventBatch> {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new ApplicationError('INVALID_INPUT', 'Invalid event cursor');
  kernel.guard.trusted(context);
  if (after > snapshot.cursor)
    throw new ApplicationError('CONFLICT', 'Event cursor requires a fresh snapshot');
  // Retention removed entries this cursor has not seen; a partial history would look complete.
  if (after < (snapshot.journalFloor ?? 0)) {
    kernel.guard.trusted(context);
    return {
      events: [],
      cursor: snapshot.cursor,
      authorizationRevision: snapshot.authorizationRevision,
      reset: true,
    };
  }
  const events = [];
  for (const event of snapshot.journal)
    if (
      event.cursor > after &&
      grantPermits(context.grant, kernel.now(), event.operation, event.resource) &&
      (await kernel.options.authorization.canReadEvent({ event, context, state: snapshot.state }))
    )
      events.push(event);
  kernel.guard.trusted(context);
  return {
    events,
    cursor: snapshot.cursor,
    authorizationRevision: snapshot.authorizationRevision,
  };
}

/** Journal reads for live queries: a pull API and a push API under the same read boundary. */
export function createEvents<State, Services>(kernel: Kernel<State, Services>) {
  async function events(after: number, context: ExecutionContext): Promise<EventBatch> {
    kernel.guard.trusted(context);
    return kernel.options.storage.read(context.workspaceId, (snapshot) =>
      eventBatch(kernel, snapshot, after, context),
    );
  }
  /** Enqueue authorized delivery synchronously while the read boundary excludes local revocation commits. */
  async function deliverEvents(
    after: number,
    context: ExecutionContext,
    deliver: (batch: EventBatch) => void,
  ): Promise<void> {
    kernel.guard.trusted(context);
    await kernel.options.storage.read(context.workspaceId, async (snapshot) => {
      const batch = await eventBatch(kernel, snapshot, after, context);
      const result: unknown = deliver(batch);
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new ApplicationError('INTERNAL', 'Event delivery callback must be synchronous');
    });
  }
  return { events, deliverEvents };
}
