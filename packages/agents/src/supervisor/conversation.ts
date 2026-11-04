import type { ConversationTurn, RunSnapshot } from '../types';
import type { SupervisorKernel } from './run';

/** The most characters of earlier turns one turn carries; the oldest turns are left out first. */
export const MAX_EARLIER_CHARS = 16_000;

/** The agent's text in a run, joined from its text events. */
export const replyOf = (run: Pick<RunSnapshot, 'events'>) =>
  run.events
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');

/**
 * The turns of `run`'s conversation before it, oldest first: each earlier run that holds a
 * request, with the text it replied. Turns of one conversation execute one after another, so the
 * earlier runs have ended when this one starts; the store lists runs in the order they queued.
 */
export async function earlierTurns(
  kernel: SupervisorKernel,
  run: RunSnapshot,
): Promise<ConversationTurn[]> {
  const snapshots = new Map((await kernel.store.list()).map((entry) => [entry.id, entry]));
  for (const [id, active] of kernel.active) snapshots.set(id, active.snapshot);
  const all = [...snapshots.values()];
  const at = all.findIndex((entry) => entry.id === run.id);
  const turns = (at < 0 ? all : all.slice(0, at))
    .filter((entry) => entry.conversationId === run.conversationId && entry.request !== undefined)
    .map((entry) => ({ request: entry.request!, reply: replyOf(entry) }));
  let size = turns.reduce((total, turn) => total + turn.request.length + turn.reply.length, 0);
  while (turns.length && size > MAX_EARLIER_CHARS) {
    const oldest = turns.shift()!;
    size -= oldest.request.length + oldest.reply.length;
  }
  return turns;
}
