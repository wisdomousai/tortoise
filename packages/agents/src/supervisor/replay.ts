import type { RunEvent } from '../types';
import { terminalStates } from '../types';
import { EventQueue } from './event-queue';
import type { SupervisorKernel } from './run';

/**
 * Replay a run's retained events after `afterSequence`, then follow it live until it ends.
 * A cursor older than the retained history is refused instead of skipping events.
 */
export async function* runEvents(
  kernel: SupervisorKernel,
  id: string,
  afterSequence = 0,
): AsyncIterable<RunEvent> {
  const run = kernel.active.get(id);
  const snapshot = run?.snapshot ?? (await kernel.store.get(id));
  if (!snapshot) throw new Error('Run not found');
  const earliest = snapshot.events[0]?.sequence ?? snapshot.nextSequence;
  if (afterSequence < earliest - 1)
    throw new Error('Run replay cursor expired; fetch the run snapshot');
  let queue: EventQueue | undefined;
  if (run && !terminalStates.has(snapshot.state)) {
    queue = new EventQueue(() => run.subscribers.delete(queue!));
    run.subscribers.add(queue);
  }
  // Registration occurs before replay; duplicates from concurrent publication are filtered.
  let cursor = afterSequence;
  try {
    for (const event of [...snapshot.events])
      if (event.sequence > cursor) {
        cursor = event.sequence;
        yield structuredClone(event);
      }
    if (queue)
      for await (const event of queue)
        if (event.sequence > cursor) {
          cursor = event.sequence;
          yield structuredClone(event);
        }
  } finally {
    await queue?.return();
  }
}
