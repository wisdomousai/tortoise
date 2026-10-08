import type { Effect, EffectOutcome } from '@agent-native/runtime';

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
 * Port to one external system of record (for example an ERP or CRM). Implementations own protocol,
 * credentials and field mapping; they never write application state themselves. Results return
 * through domain commands submitted by the dispatcher or inbound sync, under the integration principal.
 */
export interface SystemOfRecordPort<Item = unknown> {
  describe(): TargetDescription;
  /**
   * Deliver one effect at least once. Return the target's business outcome, including rejection.
   * Throw for transient failures; the dispatcher records an attempt and retries later. Throw
   * `DeliveryFailure` for a caller-safe message; other errors are recorded generically so
   * endpoints, tokens or payload fragments never reach application state.
   */
  deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<EffectOutcome>;
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
}

/** What a target knows about an earlier delivery. */
export type LookupResult =
  EffectOutcome | { readonly status: 'uncertain'; readonly reason: string } | undefined;

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
