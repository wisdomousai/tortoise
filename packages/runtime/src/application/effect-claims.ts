import { errorEnvelope } from '@tortoise/contracts';
import type { Effect, ExecutionContext, WorkspaceSnapshot } from '../types.js';
import { actorOf } from './audit.js';
import {
  attemptedEffect,
  claimedEffect,
  pendingEffect,
  publicEffect,
  putEffect,
} from './effects.js';
import { authorize, type Kernel } from './kernel.js';
import { revisionOf } from './records.js';

/** What a claim returned: the effect to deliver with its fencing token, or why it was held. */
export type ClaimResult =
  | { readonly status: 'claimed'; readonly effect: Effect; readonly fence: number }
  | { readonly status: 'held'; readonly effect: Effect; readonly reason: string };

/**
 * Ask again whether the person who committed the effect may still run the command that
 * enqueued it, on the current state. The delegation the command ran under is not reused: it
 * ended with its run, and the person behind it is who stays accountable. Returns the denial.
 */
async function recheck<State, Services>(
  kernel: Kernel<State, Services>,
  effect: Effect,
  workspaceId: string,
  snapshot: WorkspaceSnapshot<State>,
): Promise<string | undefined> {
  const capability = kernel.capabilities.get(effect.operation);
  if (!capability) return 'The command that enqueued it no longer exists';
  const actor: ExecutionContext = { workspaceId, principalId: effect.principalId };
  try {
    await authorize(kernel, capability, effect.input ?? {}, actor, snapshot, 'dispatch');
    return undefined;
  } catch (error) {
    return `The actor may no longer run ${effect.operation} (${errorEnvelope(error).message})`;
  }
}

function holdInSnapshot<State>(
  snapshot: WorkspaceSnapshot<State>,
  effect: Effect,
  reason: string,
  now: () => number,
): Effect {
  const held = attemptedEffect(effect, reason, true, now);
  putEffect(snapshot, held);
  snapshot.journal.push({
    cursor: ++snapshot.cursor,
    resource: effect.resource,
    revision: revisionOf(snapshot, effect.resource),
    type: 'effect.held',
    operation: effect.operation,
  });
  return held;
}

/**
 * Host-only: claim one pending effect for `worker` before delivering it, in one transaction.
 * The claim issues a fencing token that every attempt and completion of this delivery must
 * carry; it lapses after `leaseMs`, so another worker may claim it after a crash. Before the
 * first claim (unless `recheck` is false), the original actor is authorized again and a denial
 * holds the effect instead of claiming it, recorded in the journal and the audit log. CONFLICT
 * when the effect is completed, held or claimed by another live worker.
 */
export async function claimEffect<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  claim: { readonly worker: string; readonly leaseMs: number; readonly recheck?: boolean },
): Promise<ClaimResult> {
  kernel.guard.trusted(context);
  const result = await kernel.options.storage.transact(
    context.workspaceId,
    async (snapshot): Promise<ClaimResult> => {
      const effect = pendingEffect(snapshot, id);
      const claimed = claimedEffect(effect, claim.worker, claim.leaseMs, kernel.now);
      // Only before the first claim: once a worker may have sent it, holding cannot un-send it,
      // and the target's response must still be recordable after the actor lost access.
      const denial =
        claim.recheck === false || effect.fence !== undefined
          ? undefined
          : await recheck(kernel, effect, context.workspaceId, snapshot);
      if (denial !== undefined) {
        const held = holdInSnapshot(snapshot, effect, denial, kernel.now);
        return { status: 'held', effect: held, reason: denial };
      }
      putEffect(snapshot, claimed);
      return { status: 'claimed', effect: claimed, fence: claimed.fence! };
    },
  );
  if (result.status === 'held')
    await kernel.audit.after([
      {
        kind: 'effect.held',
        outcome: 'denied',
        operation: result.effect.operation,
        resources: [result.effect.resource],
        actor: actorOf(context),
        reason: 'DISPATCH_RECHECK',
        data: { effectId: id, target: result.effect.target, failure: result.reason.slice(0, 500) },
      },
    ]);
  return { ...result, effect: publicEffect(result.effect) };
}
