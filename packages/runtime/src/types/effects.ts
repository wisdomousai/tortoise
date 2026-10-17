import type { JsonValue } from '@agent-native/contracts';

/**
 * A post-commit request to an external system of record. It is committed atomically with the
 * command that enqueues it, so a rejected command never produces an effect and a committed one
 * cannot lose it. Delivery happens later, outside any transaction, at least once.
 */
export interface EffectRequest {
  readonly target: string;
  readonly type: string;
  readonly payload: JsonValue;
  /** A changed business resource the effect reports on. Its read policy governs delivery events. */
  readonly resource: string;
}
/** The system of record's answer. A rejection is business data, not a transport failure. */
export type EffectOutcome =
  | { readonly status: 'accepted'; readonly externalRef?: string }
  | { readonly status: 'rejected'; readonly code: string; readonly message: string };
export interface Effect extends EffectRequest {
  /** Stable for the life of the effect; dispatchers use it as the target's idempotency key. */
  readonly id: string;
  readonly operation: string;
  readonly principalId: string;
  readonly createdAt: number;
  /**
   * The application's `contractVersion` when the command enqueued it. An upgrade never rewrites a
   * recorded effect, so its target reads the payload by this version. Absent when none was set.
   */
  readonly contractVersion?: string;
  /** `cancelled`: a command withdrew it before any worker claimed it; it was never sent. */
  readonly status: 'pending' | EffectOutcome['status'] | 'cancelled';
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  /** Caller-safe, bounded transient failure text from the most recent delivery attempt. */
  readonly lastFailure?: string;
  readonly settledAt?: number;
  readonly outcome?: EffectOutcome;
  /**
   * Set while a pending effect awaits reconciliation: the target may or may not have applied it
   * (for example a screen procedure was interrupted), so redelivery could act twice. Dispatchers
   * skip held effects. A domain command resolves it with `settleEffect` (it was applied, or it was
   * refused) or `releaseEffect` (it was not applied; deliver again).
   */
  readonly heldAt?: number;
  /** Caller-safe, bounded reason for the hold. */
  readonly holdReason?: string;
  /**
   * Set when a domain command released a held effect (`releaseEffect`: it was not applied), and
   * cleared when the next attempt is recorded. A lookup that would otherwise hold the effect again
   * on the same evidence delivers it instead, because a person already decided.
   */
  readonly releasedAt?: number;
  /** The worker that may deliver it now; see `EffectClaim`. */
  readonly claim?: EffectClaim;
  /** The last fencing token issued; a newer claim always gets a larger one. */
  readonly fence?: number;
  /**
   * Set once the target acknowledged the effect but has not decided it yet (`upstream-pending`).
   * Dispatchers then poll the target's lookup instead of delivering again.
   */
  readonly upstreamAt?: number;
  /** The target's reference for the acknowledged effect, when it gave one. */
  readonly upstreamRef?: string;
  /** Caller-safe, bounded reason a command gave for cancelling it. */
  readonly cancelReason?: string;
  /**
   * The enqueuing command's input, for the dispatch-time recheck. Kernel-only: every effect the
   * runtime hands out (to dispatchers, ports, handlers) leaves it out.
   */
  readonly input?: JsonValue;
}
/**
 * A worker's claim to deliver one effect. The fencing token grows with every claim, and an
 * attempt or settlement that carries an older token than the effect's current claim is refused,
 * so a worker that paused past its lease cannot overwrite the outcome of the worker after it.
 */
export interface EffectClaim {
  readonly worker: string;
  readonly fence: number;
  readonly expiresAt: number;
}
