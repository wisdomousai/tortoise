import { ApplicationError, type SyncBatch, type Target } from '@tortoise/contracts';
import type {
  Effect,
  EffectOutcome,
  ExecutionContext,
  HandlerContext,
  HandlerContribution,
  IntegrationAllowlist,
} from '@tortoise/runtime';

/** Where a target's inbound position is stored in the module's state. */
export interface TargetCursor {
  watermark?: string;
  lastSyncAt?: number;
}

/** A record that was forwarded to a target and now carries its delivery state. */
export interface Delivered {
  effectId: string;
  sync: 'pending' | 'accepted' | 'rejected';
  sorRef?: string;
  rejection?: { code: string; message: string };
}

export interface TargetHandlerOptions<State, Services, Item, Extra, Status> {
  /** The mutable object in `state` that holds the watermark and the last sync time. */
  readonly cursor: (state: State) => TargetCursor;
  /** Instance clock for `lastSyncAt`; `Date.now` when omitted. */
  readonly now?: (context: HandlerContext<State, Services>) => number;
  /**
   * Apply a completed outcome to the record the effect forwarded, in the same transaction. Throw
   * `NOT_FOUND` when no record forwarded this effect; `completeDelivery` does both for the usual case.
   */
  readonly onOutcome: (
    effect: Effect,
    outcome: EffectOutcome,
    context: HandlerContext<State, Services>,
  ) => void;
  /**
   * Whether the calling integration principal may complete this effect. By default it completes
   * effects of this target only. Override when one principal completes several targets.
   */
  readonly mayComplete?: (effect: Effect, context: HandlerContext<State, Services>) => boolean;
  /** Apply one feed batch after the watermark check; return how many items changed something. */
  readonly applyBatch?: (
    batch: SyncBatch<Item, Extra>,
    context: HandlerContext<State, Services>,
  ) => number;
  /** The application's own status fields, scoped to what the caller may see. */
  readonly status: (context: HandlerContext<State, Services>) => Status;
  /**
   * Source versions, for feeds whose items can come out of order across batches (several
   * partitions, a replayed export). Each item names its record and the target's version of it;
   * an item whose version is not newer than the last applied one is dropped before `applyBatch`.
   */
  readonly versions?: SourceVersions<State, Item>;
}

/** Where the last applied source version of each record is kept, and how an item names it. */
export interface SourceVersions<State, Item> {
  /** The mutable map in `state` from record key to the last applied version. */
  readonly store: (state: State) => Record<string, number>;
  readonly of: (item: Item) => { readonly key: string; readonly version: number };
}

/**
 * The items of a batch that are newer than what was applied, recording their versions. Later
 * duplicates of a key in the same batch must be newer still. Runs inside the sync transaction.
 */
export function newerItems<State, Item>(
  items: readonly Item[],
  state: State,
  versions: SourceVersions<State, Item>,
): Item[] {
  const store = versions.store(state);
  return items.filter((item) => {
    const { key, version } = versions.of(item);
    if (!Number.isFinite(version)) throw new ApplicationError('INVALID_INPUT', 'Invalid version');
    const applied = Object.hasOwn(store, key) ? store[key]! : undefined;
    if (applied !== undefined && version <= applied) return false;
    Object.defineProperty(store, key, {
      value: version,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    return true;
  });
}

/**
 * Record `outcome` on the record that forwarded `effect`: its delivery state, the target's
 * reference when accepted, the reason when rejected. A missing record, or one that forwarded a
 * different effect, is `NOT_FOUND`, so an outcome is never applied to the wrong record.
 */
export function completeDelivery(
  record: Delivered | undefined,
  effect: Effect,
  outcome: EffectOutcome,
): Delivered {
  if (!record || record.effectId !== effect.id)
    throw new ApplicationError('NOT_FOUND', 'Forwarded record unavailable');
  record.sync = outcome.status;
  if (outcome.status === 'accepted' && outcome.externalRef) record.sorRef = outcome.externalRef;
  if (outcome.status === 'rejected')
    record.rejection = { code: outcome.code, message: outcome.message };
  return record;
}

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

function completeHandler<State, Services>(
  target: Target,
  options: TargetHandlerOptions<State, Services, unknown, unknown, unknown>,
): HandlerContribution<State, Services> {
  return {
    capability: target.complete as never,
    handle(input, ctx) {
      const { effectId, outcome, fence } = input as {
        effectId: string;
        outcome: EffectOutcome;
        fence?: number;
      };
      const effect = ctx.effects().find((candidate) => candidate.id === effectId);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      // Checked against the effect itself, inside the transaction, before anything changes.
      const owns =
        options.mayComplete ?? ((candidate: Effect) => candidate.target === target.target);
      if (!owns(effect, ctx))
        throw new ApplicationError('FORBIDDEN', 'Effect belongs to another integration');
      const completed = ctx.completeEffect(
        effect.id,
        outcome,
        fence === undefined ? {} : { fence },
      );
      options.onOutcome(completed, outcome, ctx);
      ctx.change(completed.resource);
      return { resource: completed.resource, sync: outcome.status };
    },
  };
}

function syncHandler<State, Services>(
  target: Target,
  options: TargetHandlerOptions<State, Services, unknown, unknown, unknown>,
): HandlerContribution<State, Services> {
  if (!options.applyBatch) throw new Error(`Target ${target.target} has a feed but no applyBatch`);
  const apply = options.applyBatch;
  return {
    capability: target.sync as never,
    handle(input, ctx) {
      const batch = input as SyncBatch<unknown, unknown>;
      const cursor = options.cursor(ctx.state);
      // Watermarks order feed batches; a stale or replayed range cannot reapply old data.
      if (batch.from !== cursor.watermark)
        throw new ApplicationError('CONFLICT', 'Watermark changed', {
          watermark: cursor.watermark ?? null,
        });
      const fresh = options.versions
        ? { ...batch, items: newerItems(batch.items, ctx.state, options.versions) }
        : batch;
      const items = apply(fresh, ctx);
      cursor.watermark = batch.to;
      cursor.lastSyncAt = (options.now ?? (() => Date.now()))(ctx);
      ctx.change(target.syncResource);
      return { watermark: batch.to, items };
    },
  };
}

/**
 * The handlers of a declared target: complete, the feed's sync when it has one, and status. Only
 * the domain parts are supplied: how an outcome changes the forwarded record, how a batch item
 * changes local state, and the scoped status counts.
 */
export function targetHandlers<State, Services, Item = unknown, Extra = unknown, Status = object>(
  target: Target,
  options: TargetHandlerOptions<State, Services, Item, Extra, Status>,
): HandlerContribution<State, Services>[] {
  const erased = options as TargetHandlerOptions<State, Services, unknown, unknown, unknown>;
  return [
    completeHandler(target, erased),
    ...(target.sync ? [syncHandler(target, erased)] : []),
    {
      capability: target.status as never,
      handle: (_input, ctx) => {
        const cursor = options.cursor(ctx.state);
        return compact({
          watermark: cursor.watermark,
          lastSyncAt: cursor.lastSyncAt,
          ...(options.status(ctx) as object),
        });
      },
    },
  ];
}

/**
 * The trusted identity of a target's integration principal. Its grant names only the target's
 * operations, so a misbehaving adapter cannot call business commands or read other features.
 */
export function targetContext(
  target: Target,
  workspaceId: string,
  principalId: string,
): ExecutionContext {
  return {
    workspaceId,
    principalId,
    channel: 'integration',
    grant: { operations: [...target.integrationOperations], principalId, workspaceId },
  };
}

/** The integration allowlist of a target's integration principal, for `definePolicy`. */
export function targetAllowlist<State>(
  target: Target,
  is: (state: State, principalId: string) => boolean,
): IntegrationAllowlist<State> {
  return { is, operations: target.integrationOperations };
}

/**
 * Policy rules for a target's operations: complete and sync belong to its integration principal only, and status is
 * open to every caller, scoped by its handler.
 */
export function targetRules(target: Target): Record<string, 'open' | 'integration'> {
  return {
    [target.complete.id]: 'integration',
    ...(target.sync ? { [target.sync.id]: 'integration' as const } : {}),
    [target.status.id]: 'open',
  };
}
