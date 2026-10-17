import { z } from 'zod';
import { defineCapability } from './capability';
import { jsonSchema } from './schema';

/** The outcome a system of record reports for one forwarded effect, as settle input. */
export const effectOutcomeSchema = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().max(256).optional() }),
  z.strictObject({
    status: z.literal('rejected'),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2000),
  }),
]);
export type EffectOutcomeInput = z.output<typeof effectOutcomeSchema>;

/**
 * Where a forwarded record stands with its system of record. `held` is reported by status
 * queries only: a held effect is pending until a person reconciles it.
 */
export const deliveryStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export const rejectionSchema = z.strictObject({ code: z.string(), message: z.string() });
/** The fields every forwarded record carries, as callers see them. */
export const deliveryShape = {
  sync: deliveryStatusSchema,
  sorRef: z.string().optional(),
  rejection: rejectionSchema.optional(),
};

/** A UI binding, or the reason an operation has none. */
type UiDeclaration = { readonly binding?: string; readonly exception?: string };

export interface TargetSpec<
  Target extends string,
  Settle extends string,
  Sync extends string,
  Status extends string,
  Item extends z.ZodType,
  Extra extends z.ZodRawShape,
  StatusShape extends z.ZodRawShape,
> {
  /** Outbox target name; effects name it, and so does the destination that carries it. */
  readonly target: Target;
  /** Permission subject of the generated operations, for example `CrmSync`. */
  readonly resourceType: string;
  /** Operation IDs; the defaults are `<target>.effect.settle`, `<target>.sync`, `<target>.sync.status`. */
  readonly operations?: {
    readonly settle?: Settle;
    readonly sync?: Sync;
    readonly status?: Status;
  };
  /** Records the target settles; their changes refresh the status query. */
  readonly settles: readonly string[];
  /** The inbound feed, when the target has one: one item schema plus optional side lists. */
  readonly feed?: {
    readonly item: Item;
    /** The most items one batch may carry. */
    readonly max: number;
    /** Further optional input fields of a batch, for example code catalogs. */
    readonly extra?: Extra;
    /** Records a batch changes, besides the sync resource. */
    readonly changes: readonly string[];
  };
  /** Fields of the status query besides `watermark` and `lastSyncAt`, scoped by the handler. */
  readonly status: StatusShape;
  readonly descriptions: {
    readonly settle: string;
    readonly sync?: string;
    readonly status: string;
  };
  readonly ui?: { readonly status?: UiDeclaration };
}

export type SyncBatch<Item, Extra> = {
  readonly from?: string;
  readonly to: string;
  readonly items: readonly Item[];
} & Extra;

const exception = 'integration principal; the outbox dispatcher and inbound sync';
type Common = Pick<
  TargetSpec<string, string, string, string, z.ZodType, {}, {}>,
  'target' | 'resourceType' | 'settles' | 'descriptions'
>;

/** Record the target's outcome for one effect; the integration principal's only write path out. */
function settleCapability<const Settle extends string>(id: Settle, spec: Common) {
  return defineCapability({
    id,
    kind: 'command',
    description: spec.descriptions.settle,
    input: jsonSchema(
      z.strictObject({ effectId: z.string().min(1).max(128), outcome: effectOutcomeSchema }),
    ),
    output: jsonSchema(
      z.strictObject({ resource: z.string(), sync: z.enum(['accepted', 'rejected']) }),
    ),
    permission: { action: 'settle', resourceType: spec.resourceType },
    dependencies: spec.settles,
    ui: { exception },
  });
}

/** Apply one feed batch bound to the stored watermark. */
function syncCapability<
  const Sync extends string,
  Item extends z.ZodType,
  Extra extends z.ZodRawShape,
>(
  id: Sync,
  spec: Common,
  feed: NonNullable<TargetSpec<string, string, Sync, string, Item, Extra, {}>['feed']>,
) {
  return defineCapability({
    id,
    kind: 'command',
    description:
      spec.descriptions.sync ?? `Integration principal only: apply a ${spec.target} feed batch.`,
    input: jsonSchema(
      z.strictObject({
        from: z.string().max(256).optional(),
        to: z.string().min(1).max(256),
        items: z.array(feed.item).max(feed.max),
        ...feed.extra,
      }) as unknown as z.ZodType<SyncBatch<z.output<Item>, z.output<z.ZodObject<Extra>>>>,
    ),
    output: jsonSchema(z.strictObject({ watermark: z.string(), items: z.number().int() })),
    permission: { action: 'sync', resourceType: spec.resourceType },
    dependencies: [...new Set([...feed.changes, 'sync'])],
    ui: { exception },
  });
}

/**
 * Declare a system of record this application forwards to and, optionally, pulls from. The
 * result is up to three ordinary catalog operations with literal IDs, all for the target's
 * integration principal except the status query:
 *
 * - settle: record the target's outcome for one effect (`{ effectId, outcome }`).
 * - sync: apply one feed batch (`{ from?, to, items, ...extra }`); a `from` that is not the
 *   stored watermark conflicts, so a stale or replayed range cannot apply old data.
 * - status: the stored watermark and last sync time, plus the application's own counts.
 *
 * The server pairs it with `targetHandlers` and `connectTarget` from `@agent-native/integration`.
 * Browser-safe.
 */
export function defineTarget<
  const Target extends string,
  const Settle extends string = `${Target}.effect.settle`,
  const Sync extends string = `${Target}.sync`,
  const Status extends string = `${Target}.sync.status`,
  Item extends z.ZodType = z.ZodNever,
  Extra extends z.ZodRawShape = {},
  StatusShape extends z.ZodRawShape = {},
>(spec: TargetSpec<Target, Settle, Sync, Status, Item, Extra, StatusShape>) {
  const ids = {
    settle: (spec.operations?.settle ?? `${spec.target}.effect.settle`) as Settle,
    sync: (spec.operations?.sync ?? `${spec.target}.sync`) as Sync,
    status: (spec.operations?.status ?? `${spec.target}.sync.status`) as Status,
  };
  const syncResource = `sync:${spec.target}`;
  const settle = settleCapability(ids.settle, spec);
  const status = defineCapability({
    id: ids.status,
    kind: 'query',
    description: spec.descriptions.status,
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({
        watermark: z.string().optional(),
        lastSyncAt: z.number().int().nonnegative().optional(),
        ...spec.status,
      }) as unknown as z.ZodType<
        { watermark?: string; lastSyncAt?: number } & z.output<z.ZodObject<StatusShape>>
      >,
    ),
    permission: { action: 'read', resourceType: spec.resourceType },
    dependencies: [...new Set([...spec.settles, 'sync'])],
    ui: spec.ui?.status ?? { binding: ids.status },
  });
  const feed = spec.feed;
  const sync = feed ? syncCapability<Sync, Item, Extra>(ids.sync, spec, feed) : undefined;
  return Object.freeze({
    target: spec.target,
    syncResource,
    settle,
    status,
    /** Present exactly when the target declares a feed. */
    sync: sync as [Item] extends [z.ZodNever] ? undefined : NonNullable<typeof sync>,
    /** Every operation the integration principal may call. */
    integrationOperations: [
      ids.settle,
      ids.status,
      ...(feed ? [ids.sync] : []),
    ] as readonly string[],
    capabilities: (sync ? [settle, sync, status] : [settle, status]) as readonly (
      typeof settle | NonNullable<typeof sync> | typeof status
    )[],
  });
}
/** Any declared target, as the server-side helpers accept it. */
export interface Target {
  readonly target: string;
  readonly syncResource: string;
  readonly settle: { readonly id: string };
  readonly status: { readonly id: string };
  readonly sync?: { readonly id: string } | undefined;
  readonly integrationOperations: readonly string[];
}
