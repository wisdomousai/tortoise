import { z } from 'zod';
import { defineCapability } from './capability';
import { jsonSchema } from './schema';

/** The outcome a system of record reports for one forwarded effect, as complete input. */
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
  Complete extends string,
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
  /** Operation IDs; the defaults are `<target>.effect.complete`, `<target>.sync`, `<target>.sync.status`. */
  readonly operations?: {
    readonly complete?: Complete;
    readonly sync?: Sync;
    readonly status?: Status;
  };
  /** Records the target completes; their changes refresh the status query. */
  readonly changes: readonly string[];
  /** The inbound side, when the target has one: one item schema plus optional side lists. */
  readonly inbound?: {
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
    readonly complete: string;
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
  'target' | 'resourceType' | 'changes' | 'descriptions'
>;

/** Record the target's outcome for one effect; the integration principal's only write path out. */
function completeCapability<const Complete extends string>(id: Complete, spec: Common) {
  return defineCapability({
    id,
    kind: 'command',
    description: spec.descriptions.complete,
    input: jsonSchema(
      z.strictObject({
        effectId: z.string().min(1).max(128),
        outcome: effectOutcomeSchema,
        // The dispatcher's claim; an older one than the effect's current claim conflicts.
        fence: z.number().int().min(1).optional(),
      }),
    ),
    output: jsonSchema(
      z.strictObject({ resource: z.string(), sync: z.enum(['accepted', 'rejected']) }),
    ),
    permission: { action: 'complete', resourceType: spec.resourceType },
    dependencies: spec.changes,
    ui: { exception },
  });
}

/** Apply one inbound batch bound to the stored watermark. */
function syncCapability<
  const Sync extends string,
  Item extends z.ZodType,
  Extra extends z.ZodRawShape,
>(
  id: Sync,
  spec: Common,
  inbound: NonNullable<TargetSpec<string, string, Sync, string, Item, Extra, {}>['inbound']>,
) {
  return defineCapability({
    id,
    kind: 'command',
    description:
      spec.descriptions.sync ?? `Integration principal only: apply a ${spec.target} inbound batch.`,
    input: jsonSchema(
      z.strictObject({
        from: z.string().max(256).optional(),
        to: z.string().min(1).max(256),
        items: z.array(inbound.item).max(inbound.max),
        ...inbound.extra,
      }) as unknown as z.ZodType<SyncBatch<z.output<Item>, z.output<z.ZodObject<Extra>>>>,
    ),
    output: jsonSchema(z.strictObject({ watermark: z.string(), items: z.number().int() })),
    permission: { action: 'sync', resourceType: spec.resourceType },
    dependencies: [...new Set([...inbound.changes, 'sync'])],
    ui: { exception },
  });
}

/**
 * Declare a system of record this application forwards to and, optionally, pulls from. The
 * result is up to three ordinary catalog operations with literal IDs, all for the target's
 * integration principal except the status query:
 *
 * - complete: record the target's outcome for one effect (`{ effectId, outcome, fence? }`).
 * - sync: apply one inbound batch (`{ from?, to, items, ...extra }`); a `from` that is not the
 *   stored watermark conflicts, so a stale or replayed range cannot apply old data.
 * - status: the stored watermark and last sync time, plus the application's own counts.
 *
 * The server pairs it with `targetHandlers` and `connectTarget` from `@tortoise/integration`.
 * Browser-safe.
 */
export function defineTarget<
  const Target extends string,
  const Complete extends string = `${Target}.effect.complete`,
  const Sync extends string = `${Target}.sync`,
  const Status extends string = `${Target}.sync.status`,
  Item extends z.ZodType = z.ZodNever,
  Extra extends z.ZodRawShape = {},
  StatusShape extends z.ZodRawShape = {},
>(spec: TargetSpec<Target, Complete, Sync, Status, Item, Extra, StatusShape>) {
  const ids = {
    complete: (spec.operations?.complete ?? `${spec.target}.effect.complete`) as Complete,
    sync: (spec.operations?.sync ?? `${spec.target}.sync`) as Sync,
    status: (spec.operations?.status ?? `${spec.target}.sync.status`) as Status,
  };
  const syncResource = `sync:${spec.target}`;
  const complete = completeCapability(ids.complete, spec);
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
    dependencies: [...new Set([...spec.changes, 'sync'])],
    ui: spec.ui?.status ?? { binding: ids.status },
  });
  const inbound = spec.inbound;
  const sync = inbound ? syncCapability<Sync, Item, Extra>(ids.sync, spec, inbound) : undefined;
  return Object.freeze({
    target: spec.target,
    syncResource,
    complete,
    status,
    /** Present exactly when the target declares inbound sync. */
    sync: sync as [Item] extends [z.ZodNever] ? undefined : NonNullable<typeof sync>,
    /** Every operation the integration principal may call. */
    integrationOperations: [
      ids.complete,
      ids.status,
      ...(inbound ? [ids.sync] : []),
    ] as readonly string[],
    capabilities: (sync ? [complete, sync, status] : [complete, status]) as readonly (
      typeof complete | NonNullable<typeof sync> | typeof status
    )[],
  });
}
/** Any declared target, as the server-side helpers accept it. */
export interface Target {
  readonly target: string;
  readonly syncResource: string;
  readonly complete: { readonly id: string };
  readonly status: { readonly id: string };
  readonly sync?: { readonly id: string } | undefined;
  readonly integrationOperations: readonly string[];
}
