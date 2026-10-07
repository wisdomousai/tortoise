import { errorEnvelope } from '@agent-native/contracts';
import type {
  CommandReceipt,
  Effect,
  EffectOutcome,
  ExecutionContext,
  Invocation,
} from '@agent-native/runtime';

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

/** Host-only application methods a dispatcher needs. Transports never expose the first two. */
export interface DispatcherApplication {
  pendingEffects(
    context: ExecutionContext,
    filter?: { readonly target?: string; readonly limit?: number; readonly includeHeld?: boolean },
  ): Promise<readonly Effect[]>;
  recordAttempt(
    context: ExecutionContext,
    id: string,
    failure: string,
    attempt?: { readonly hold?: boolean },
  ): Promise<Effect>;
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
}
export interface DispatchReport {
  accepted: number;
  rejected: number;
  retried: number;
  deferred: number;
  /** Effects whose outcome at the target is unknown; they wait for a reconciliation command. */
  held: number;
}
export interface EffectDispatcherOptions {
  readonly application: DispatcherApplication;
  readonly port: SystemOfRecordPort;
  /**
   * Trusted integration identity supplied by the host. Give it a grant limited to the settlement
   * operation so a compromised port cannot drive other business commands.
   */
  readonly context: ExecutionContext;
  /** Domain command that records an outcome through `ctx.settleEffect` and updates domain state. */
  readonly settleOperation: string;
  readonly settleInput?: (effect: Readonly<Effect>, outcome: EffectOutcome) => unknown;
  /** Delay before retry after `attempts` failures. Defaults to exponential backoff capped at 60 s. */
  readonly backoff?: (attempts: number) => number;
  readonly batchSize?: number;
  /** Must match the application's clock, which stamps `lastAttemptAt`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

interface Loop {
  start(intervalMs: number): void;
  stop(): Promise<void>;
}
function createLoop(runOnce: (signal: AbortSignal) => Promise<unknown>): Loop {
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  return {
    start(intervalMs) {
      if (controller) return;
      const active = new AbortController();
      controller = active;
      running = (async () => {
        while (!active.signal.aborted) {
          // A failed pass must not stop background synchronization; the next pass retries.
          await runOnce(active.signal).catch(() => undefined);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, intervalMs);
            active.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
      })();
    },
    async stop() {
      controller?.abort();
      await running;
      controller = undefined;
      running = undefined;
    },
  };
}

/**
 * Delivers committed outbox effects to one target outside every transaction, then records each
 * outcome through the domain's settlement command. Delivery is at least once: duplicates are
 * prevented by the target deduplicating on the effect ID, or, for targets that cannot, by looking
 * up an earlier delivery before every send. A settlement replay uses `settle:<effectId>` as its
 * idempotency key, so a lost settlement response is safe to repeat.
 */
export function createEffectDispatcher(options: EffectDispatcherOptions) {
  const description = options.port.describe();
  if (!description.idempotentDelivery && !options.port.lookup)
    throw new Error(`Target ${description.target} needs lookup because delivery is not idempotent`);
  const now = options.now ?? Date.now;
  const backoff =
    options.backoff ?? ((attempts: number) => Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
  const settleInput =
    options.settleInput ??
    ((effect: Readonly<Effect>, outcome: EffectOutcome) => ({ effectId: effect.id, outcome }));

  async function runOnce(
    signal: AbortSignal = new AbortController().signal,
    { ignoreBackoff = false } = {},
  ): Promise<DispatchReport> {
    const report: DispatchReport = { accepted: 0, rejected: 0, retried: 0, deferred: 0, held: 0 };
    const effects = await options.application.pendingEffects(options.context, {
      target: description.target,
      limit: options.batchSize ?? 50,
    });
    for (const effect of effects) {
      if (signal.aborted) break;
      if (
        !ignoreBackoff &&
        effect.lastAttemptAt !== undefined &&
        now() < effect.lastAttemptAt + backoff(effect.attempts)
      ) {
        report.deferred++;
        continue;
      }
      let outcome: EffectOutcome | undefined;
      try {
        // A non-idempotent target may already hold a delivery whose response or settlement was
        // lost, so it is always checked before sending again.
        if (!description.idempotentDelivery) {
          const found = await options.port.lookup!(effect.id, signal, effect);
          if (found?.status === 'uncertain') {
            // Neither confirmed nor ruled out: delivering again could act twice. A person (or an
            // agent through the reconciliation command) decides.
            await options.application.recordAttempt(options.context, effect.id, found.reason, {
              hold: true,
            });
            report.held++;
            continue;
          }
          outcome = found;
        }
        outcome ??= await options.port.deliver(effect, signal);
      } catch (error) {
        const uncertain = error instanceof DeliveryUncertain;
        // An uncertain outcome is recorded even during shutdown: the target may have changed, and
        // an unrecorded attempt looks fresh (`attempts === 0`) to the next process, which would
        // deliver again. Recording uses the dispatcher's own context, not the cancelled signal.
        if (signal.aborted && !uncertain) break;
        await options.application.recordAttempt(
          options.context,
          effect.id,
          error instanceof DeliveryFailure ? error.message : 'Delivery failed',
          uncertain ? { hold: true } : {},
        );
        if (uncertain) report.held++;
        else report.retried++;
        if (signal.aborted) break;
        continue;
      }
      try {
        await options.application.invokeRaw(
          {
            operation: options.settleOperation,
            input: settleInput(effect, outcome),
            idempotencyKey: `settle:${effect.id}`,
          },
          options.context,
        );
        if (outcome.status === 'accepted') report.accepted++;
        else report.rejected++;
      } catch (error) {
        const { code } = errorEnvelope(error);
        // Another dispatcher settled it first; the target already holds a single record.
        if (code === 'CONFLICT') continue;
        await options.application
          .recordAttempt(options.context, effect.id, `Settlement failed (${code})`)
          .catch(() => undefined);
        report.retried++;
      }
    }
    return report;
  }

  /**
   * Deliver until nothing is pending or the timeout passes, ignoring backoff. Returns the number of
   * effects still awaiting delivery; held effects await reconciliation and are not counted. An
   * ephemeral host calls this before teardown so captured data is not silently abandoned.
   * The deadline aborts a delivery still in flight, so a hung target cannot hang the drain; an
   * adapter that already acted reports that as `DeliveryUncertain`, which is held, not retried.
   */
  async function drain(timeoutMs: number, pollMs = 200): Promise<number> {
    // A timeout is elapsed time; the injected clock may be frozen or skewed for backoff tests.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        controller.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
          once: true,
        });
      });
    try {
      for (;;) {
        await runOnce(controller.signal, { ignoreBackoff: true });
        const remaining = (
          await options.application.pendingEffects(options.context, {
            target: description.target,
          })
        ).length;
        if (remaining === 0 || controller.signal.aborted) return remaining;
        await pause(pollMs);
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  return { target: description.target, runOnce, drain, ...createLoop((signal) => runOnce(signal)) };
}

export interface TargetBacklog {
  readonly target: string;
  /** Effects still awaiting delivery. */
  readonly pending: number;
  /** Effects whose outcome is unknown; they wait for reconciliation, not delivery. */
  readonly held: number;
  /** Whether a dispatcher in this process delivers to the target. */
  readonly deliverable: boolean;
}

/**
 * Drain every dispatcher a host composed, concurrently under one deadline, then account for the
 * whole outbox by target. A target with pending effects but no dispatcher here (a screen bridge
 * that only a running host owns, say) is reported as not deliverable instead of being left out,
 * so `pending` is zero only when nothing in the workspace still awaits delivery. Held effects
 * are reported but not counted: they wait for a reconciliation command. `context` is the trusted
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
  const backlog = new Map<string, { pending: number; held: number }>(
    options.dispatchers.map((dispatcher) => [dispatcher.target, { pending: 0, held: 0 }]),
  );
  const effects = await options.application.pendingEffects(options.context, {
    limit: 10_000,
    includeHeld: true,
  });
  for (const effect of effects) {
    const entry = backlog.get(effect.target) ?? { pending: 0, held: 0 };
    if (effect.heldAt === undefined) entry.pending++;
    else entry.held++;
    backlog.set(effect.target, entry);
  }
  const deliverable = new Set(options.dispatchers.map((dispatcher) => dispatcher.target));
  const targets = [...backlog]
    .map(([target, counts]) => ({ target, ...counts, deliverable: deliverable.has(target) }))
    .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return { pending: targets.reduce((sum, target) => sum + target.pending, 0), targets };
}

export interface InboundSyncOptions<Item> {
  readonly application: Pick<DispatcherApplication, 'invokeRaw'>;
  readonly port: SystemOfRecordPort<Item>;
  /** Trusted integration identity, granted only the sync operation. */
  readonly context: ExecutionContext;
  /** Domain command that validates `from` against its stored watermark and applies the items. */
  readonly syncOperation: string;
  /** Current watermark from authoritative domain state, normally through an authorized query. */
  readonly readCursor: () => Promise<string | undefined>;
  readonly toInput: (batch: {
    readonly from?: string;
    readonly to: string;
    readonly items: readonly Item[];
  }) => unknown;
  readonly maxBatches?: number;
}

/**
 * Pulls target changes and submits them as ordinary sync commands; it never writes storage. The
 * idempotency key binds the watermark range, so a repeated pass after a lost response is safe, and
 * the domain command rejects a stale `from` watermark with CONFLICT.
 */
export function createInboundSync<Item>(options: InboundSyncOptions<Item>) {
  if (!options.port.pull) throw new Error('Inbound sync requires a target that supports pull');
  async function runOnce(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ batches: number; items: number }> {
    let batches = 0;
    let items = 0;
    for (let index = 0; index < (options.maxBatches ?? 20) && !signal.aborted; index++) {
      const from = await options.readCursor();
      const batch = await options.port.pull!(from, signal);
      if (batch.cursor === from && batch.items.length === 0) break;
      await options.application.invokeRaw(
        {
          operation: options.syncOperation,
          input: options.toInput({
            ...(from === undefined ? {} : { from }),
            to: batch.cursor,
            items: batch.items,
          }),
          idempotencyKey: `sync:${from ?? ''}:${batch.cursor}`,
        },
        options.context,
      );
      batches++;
      items += batch.items.length;
      if (!batch.more) break;
    }
    return { batches, items };
  }
  return { target: options.port.describe().target, runOnce, ...createLoop(runOnce) };
}

export interface TargetIntegrationOptions<Item> {
  readonly application: DispatcherApplication & {
    query(
      request: { readonly operation: string; readonly input: unknown },
      context: ExecutionContext,
    ): Promise<{ readonly data: unknown }>;
  };
  readonly port: SystemOfRecordPort<Item>;
  /**
   * Trusted identity for both directions. Grant it only the settle, sync and status operations,
   * so a misbehaving adapter cannot drive business commands or read other features.
   */
  readonly context: ExecutionContext;
  readonly settleOperation: string;
  readonly syncOperation: string;
  /** Authorized query whose result carries the stored inbound `watermark`. */
  readonly statusOperation: string;
  readonly toInput: InboundSyncOptions<Item>['toInput'];
}

/**
 * One system of record wired in both directions: the outbox dispatcher delivers committed effects
 * to the port and the inbound sync pulls its changes, both under one trusted identity. It owns no
 * state; every write goes through the application's settle and sync commands. `start` runs the
 * background loops (sync every 5 s and delivery every 1 s by default); `stop` waits for both.
 */
export function createTargetIntegration<Item>(options: TargetIntegrationOptions<Item>) {
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: options.port,
    context: options.context,
    settleOperation: options.settleOperation,
  });
  const inbound = createInboundSync<Item>({
    application: options.application,
    port: options.port,
    context: options.context,
    syncOperation: options.syncOperation,
    readCursor: async () =>
      (
        (await options.application.query(
          { operation: options.statusOperation, input: {} },
          options.context,
        )) as { data: { watermark?: string } }
      ).data.watermark,
    toInput: options.toInput,
  });
  return {
    target: dispatcher.target,
    port: options.port,
    context: options.context,
    dispatcher,
    inbound,
    start(intervals: { readonly deliverMs?: number; readonly syncMs?: number } = {}) {
      inbound.start(intervals.syncMs ?? 5_000);
      dispatcher.start(intervals.deliverMs ?? 1_000);
    },
    async stop() {
      await Promise.all([inbound.stop(), dispatcher.stop()]);
    },
  };
}
export type TargetIntegration<Item = unknown> = ReturnType<typeof createTargetIntegration<Item>>;
