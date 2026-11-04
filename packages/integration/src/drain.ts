import type { ExecutionContext } from '@tortoise/runtime';
import type { DispatcherApplication } from './dispatcher.js';

export interface TargetBacklog {
  readonly target: string;
  /** Effects still awaiting delivery. */
  readonly pending: number;
  /** Effects whose outcome is unknown; they wait for reconciliation, not delivery. */
  readonly held: number;
  /** Effects the target acknowledged and has not decided; they are delivered already. */
  readonly acknowledged: number;
  /** Whether a dispatcher in this process delivers to the target. */
  readonly deliverable: boolean;
}

/**
 * Drain every dispatcher a host composed, concurrently under one deadline, then account for the
 * whole outbox by target. A target with pending effects but no dispatcher here (a screen bridge
 * that only a running host owns, say) is reported as not deliverable instead of being left out,
 * so `pending` is zero only when nothing in the workspace still awaits delivery. Held effects
 * are reported but not counted: they wait for a reconciliation command. Effects the target
 * acknowledged without deciding are reported as `acknowledged` and not counted either. `context` is the trusted
 * host identity that reads the outbox; it needs no business grant. Counts stop at 10 000 per
 * read, which still reports a backlog as non-zero.
 */
export async function drainTargets(options: {
  readonly application: Pick<DispatcherApplication, 'pendingEffects'>;
  readonly context: ExecutionContext;
  readonly dispatchers: readonly { readonly target: string; drain(ms: number): Promise<number> }[];
  readonly timeoutMs: number;
}): Promise<{ pending: number; targets: TargetBacklog[] }> {
  await Promise.all(options.dispatchers.map((dispatcher) => dispatcher.drain(options.timeoutMs)));
  const backlog = new Map<string, { pending: number; held: number; acknowledged: number }>(
    options.dispatchers.map((dispatcher) => [
      dispatcher.target,
      { pending: 0, held: 0, acknowledged: 0 },
    ]),
  );
  const effects = await options.application.pendingEffects(options.context, {
    limit: 10_000,
    includeHeld: true,
  });
  for (const effect of effects) {
    const entry = backlog.get(effect.target) ?? { pending: 0, held: 0, acknowledged: 0 };
    if (effect.heldAt !== undefined) entry.held++;
    else if (effect.acknowledgedAt !== undefined) entry.acknowledged++;
    else entry.pending++;
    backlog.set(effect.target, entry);
  }
  const deliverable = new Set(options.dispatchers.map((dispatcher) => dispatcher.target));
  const targets = [...backlog]
    .map(([target, counts]) => ({ target, ...counts, deliverable: deliverable.has(target) }))
    .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return { pending: targets.reduce((sum, target) => sum + target.pending, 0), targets };
}
