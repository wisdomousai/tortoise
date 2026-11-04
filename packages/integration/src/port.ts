import type { Effect, EffectOutcome, SourceRequest } from '@tortoise/runtime';

/** Delivery guarantees a target offers; they decide how retries avoid duplicate external records. */
export interface TargetDescription {
  readonly target: string;
  /** True when `deliver` deduplicates by effect ID, so a retry can never create a second record. */
  readonly idempotentDelivery: boolean;
}
export interface PullBatch<Item> {
  readonly items: readonly Item[];
  /** Opaque target watermark after these items. */
  readonly cursor: string;
  /** More items are immediately available after `cursor`. */
  readonly more?: boolean;
}

/**
 * One page of a search. `next` is the target's own opaque cursor (at most 512 characters), which
 * the caller sends back as `cursor`. Bind it to the query and the credential that produced it,
 * and reject it as `INVALID_INPUT` otherwise, so a cursor never widens what a caller can read.
 */
export interface SearchPage {
  readonly items: readonly unknown[];
  readonly next?: string;
}

/** The credential a search acts with, and whose it is. */
export interface SearchAccess<Credential = unknown> {
  readonly credential: Credential;
  /** `caller`: the requesting principal's own credential. `service`: a technical account. */
  readonly identity: 'caller' | 'service';
}

/**
 * Port to one external system of record (for example an ERP or CRM). Implementations own protocol,
 * credentials and field mapping; they never write application state themselves. Results return
 * through domain commands submitted by the dispatcher or inbound sync, under the integration
 * principal, or, for `search`, as the transient result of a remote query.
 */
export interface SystemOfRecordPort<Item = unknown, Credential = unknown> {
  describe(): TargetDescription;
  /**
   * Deliver one effect at least once. Return the target's business outcome, including rejection.
   * Throw for transient failures; the dispatcher records an attempt and retries later. Throw
   * `DeliveryFailure` for a caller-safe message; other errors are recorded generically so
   * endpoints, tokens or payload fragments never reach application state. Return `pending`
   * when the target acknowledged the effect but decides it later (an approval queue, a batch
   * job); the dispatcher then polls `lookup`, which such a target must provide.
   */
  deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<DeliveryResult>;
  /**
   * Find a previous delivery by effect ID. Required when delivery is not idempotent. Return
   * `undefined` when the target has no trace of it (safe to deliver), or `uncertain` when the target
   * cannot tell (for example a screen shows a state that neither confirms nor rules out an earlier
   * attempt); the dispatcher then holds the effect for reconciliation instead of delivering again.
   * The effect is passed for targets whose lookup is a readback of its payload (screen bridges).
   */
  lookup?(effectId: string, signal: AbortSignal, effect?: Readonly<Effect>): Promise<LookupResult>;
  /** Changes after `cursor` (undefined for an initial load). Required for inbound sync. */
  pull?(cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<Item>>;
  /**
   * Serve a remote query (`request.operation` names it) with the target's records, acting with
   * `access.credential` so the target applies its own sharing rules. Read-only. Throw
   * `DeliveryFailure` for a caller-safe unavailability message. Required for remote sources.
   */
  search?(
    request: SourceRequest,
    access: SearchAccess<Credential>,
    signal: AbortSignal,
  ): Promise<SearchPage>;
}

/** The target holds the effect but has not decided it; `externalRef` is its reference, if any. */
export interface DeliveryAcknowledged {
  readonly status: 'pending';
  readonly externalRef?: string;
}
/** What one delivery returned: the target's decision, or its acknowledgement without one. */
export type DeliveryResult = EffectOutcome | DeliveryAcknowledged;

/**
 * What a target knows about an earlier delivery: its decision, `pending` while it still holds
 * an acknowledged effect undecided, `uncertain`, or `undefined` for no trace.
 */
export type LookupResult =
  | EffectOutcome
  | DeliveryAcknowledged
  | { readonly status: 'uncertain'; readonly reason: string }
  | undefined;

/** A transient failure whose message is safe to show to authorized application users. */
export class DeliveryFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryFailure';
  }
}
/**
 * Delivery stopped at a point where the target may or may not have applied the effect, and
 * repeating it could act twice. The dispatcher holds the effect for reconciliation instead of
 * retrying. The message must be caller-safe, as for `DeliveryFailure`.
 */
export class DeliveryUncertain extends DeliveryFailure {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryUncertain';
  }
}
