import type { BlobRef } from '@tortoise/contracts';
import type { PullBatch, SystemOfRecordPort } from '@tortoise/integration';
import type { AnyAssignmentKind } from '../kind';
import { targetOf } from '../operations';
import type { AnyOfferOf, StoredBody } from '../schemas';
import type { TargetResult } from './assignment-target';

/** A blob of an offer's brief, as the target receives it. */
export interface OfferBlob {
  readonly ref: BlobRef;
  readonly data: Uint8Array;
}

/** One report a target gives; the port names it `<effect ID>-<n>` when it has no ID of its own. */
export interface TargetReport {
  readonly id?: string;
  readonly subject?: string;
  readonly body: StoredBody;
}

/** What doing one offer's work yields: its reports, or a refusal the planner sees. */
export type TargetWork =
  | readonly TargetReport[]
  | { readonly refused: { readonly code: string; readonly message: string } };

/**
 * An assignment target's port around a function that does the work, such as a model call. `deliver`
 * runs `work` once per offer and keeps its result for the feed; delivering the same offer again
 * returns accepted without working twice. `pull` returns the results in order. A throw from
 * `work` is a transient failure the dispatcher retries.
 *
 * Results stay in memory until the target's sync applies them. If the host stops in between, the
 * offer is completed but its result is lost, and the planner withdraws the assignment and sends it
 * again; a target that runs as its own service keeps its results.
 */
export function assignmentTargetPort<K extends AnyAssignmentKind = AnyAssignmentKind>(options: {
  readonly target: string;
  /** Reads a blob the offer's brief references; `ConnectContext` readers give `readEffectBlob`. */
  readonly readBlob: (effectId: string, digest: string) => Promise<OfferBlob | undefined>;
  readonly work: (
    offer: AnyOfferOf<K>,
    tools: {
      readonly readBlob: (digest: string) => Promise<OfferBlob | undefined>;
      readonly signal: AbortSignal;
    },
  ) => Promise<TargetWork>;
}): SystemOfRecordPort<TargetResult> & { readonly results: readonly TargetResult[] } {
  const results: TargetResult[] = [];
  const worked = new Set<string>();
  return {
    results,
    describe: () => ({ target: targetOf(options.target), idempotentDelivery: true }),
    async deliver(effect, signal) {
      if (worked.has(effect.id)) return { status: 'accepted', externalRef: effect.id };
      const offer = effect.payload as unknown as AnyOfferOf<K>;
      const done = await options.work(offer, {
        readBlob: (digest) => options.readBlob(effect.id, digest),
        signal,
      });
      if ('refused' in done)
        return { status: 'rejected', code: done.refused.code, message: done.refused.message };
      results.push({
        assignmentId: offer.assignmentId,
        effectId: effect.id,
        reports: done.map((report, index) => ({
          id: report.id ?? `${effect.id}-${index + 1}`,
          ...(report.subject === undefined ? {} : { subject: report.subject }),
          body: report.body,
        })),
      });
      worked.add(effect.id);
      return { status: 'accepted', externalRef: effect.id };
    },
    async pull(cursor): Promise<PullBatch<TargetResult>> {
      const from = Number(cursor ?? 0);
      const items = results.slice(from, from + 50);
      return {
        items,
        cursor: String(from + items.length),
        more: from + items.length < results.length,
      };
    },
  };
}
