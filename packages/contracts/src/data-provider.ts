import { z } from 'zod';
import { defineCapability, type RemoteReadDeclaration } from './capability';
import type { DisplayDeclaration } from './display';
import { jsonSchema } from './schema';

/**
 * Where a remote result came from and how fresh it is. `unavailable` carries a caller-safe
 * message and no items; it is a status, not an error, so screens keep showing local data.
 */
export const remoteSourceStatusSchema = z.strictObject({
  target: z.string(),
  status: z.enum(['ok', 'unavailable']),
  fetchedAt: z.number().int(),
  /** The credential the source acted with; absent when the source was not reached. */
  identity: z.enum(['caller', 'service']).optional(),
  message: z.string().max(200).optional(),
});
export type RemoteSourceStatus = z.output<typeof remoteSourceStatusSchema>;

/**
 * An opaque page cursor issued by the source. The application never reads it; the caller passes
 * it back as `cursor` and the source decides whether it is still valid for that caller.
 */
export const remoteCursorSchema = z.string().min(1).max(512);

/**
 * Output envelope of every remote query: the items, the cursor of the next page when the source
 * has more, and the source status. A page may hold fewer items than the source returned, because
 * the item mapper and policy drop rows the caller may not see; only a missing `next` means the end.
 */
export function remoteResultSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item),
    next: remoteCursorSchema.optional(),
    source: remoteSourceStatusSchema,
  });
}
export interface RemoteResult<Item> {
  readonly items: Item[];
  readonly next?: string;
  readonly source: RemoteSourceStatus;
}

/** A UI binding, or the reason an operation has none. Defaults to binding the operation. */
type UiDeclaration = { readonly binding?: string; readonly exception?: string };

export interface DataProviderSpec<
  Id extends string,
  Query extends z.ZodObject,
  Item extends z.ZodObject<{ externalId: z.ZodString }>,
> extends RemoteReadDeclaration {
  /** Operation prefix, e.g. `crm.account`; yields `<id>.search` and `<id>.lookup`. */
  readonly id: Id;
  /** Resource type of the permission requirement; policy authorizes `search` on it. */
  readonly resourceType: string;
  /** Search input: free text and filters the target understands. `cursor` is added for paging. */
  readonly query: Query;
  /** One found record, identified by its ID in the target. */
  readonly item: Item;
  readonly descriptions: { readonly search: string; readonly lookup: string };
  readonly ui?: { readonly search?: UiDeclaration; readonly lookup?: UiDeclaration };
  /**
   * How found records are shown, on both queries. A found record is not a local resource, so
   * the declaration names no resource kind.
   */
  readonly display?: {
    readonly search?: string;
    readonly lookup?: string;
  } & Pick<DisplayDeclaration, 'titleField' | 'fields'>;
}

/** A provider's search input: its own query plus the paging cursor. */
type PagedQuery<Query extends z.ZodObject> = z.ZodObject<
  Query['shape'] & { cursor: z.ZodOptional<typeof remoteCursorSchema> },
  Query['_zod']['config']
>;

const lookupInput = z.strictObject({ externalId: z.string().min(1).max(128) });

/**
 * Declare one kind of record that lives in another system and can be searched there live. The
 * result is two ordinary catalog queries, so screens (`remoteQueryOptions`), MCP tools, the CLI
 * and the HTTP API all reach the target through the same authorization, projection and audit:
 *
 * - `<id>.search`: find records matching `query`, one page at a time. The input gains an
 *   optional `cursor`, the previous page's `next`.
 * - `<id>.lookup`: read one record by `externalId`.
 *
 * Browser-safe: this is data. The server pairs it with a source (`implementDataProvider` in
 * `@agent-native/integration`). Bringing a found record into local state is a domain command,
 * because what a local copy means differs per application.
 */
export function defineDataProvider<
  const Id extends string,
  Query extends z.ZodObject,
  Item extends z.ZodObject<{ externalId: z.ZodString }>,
>(spec: DataProviderSpec<Id, Query, Item>) {
  if ('cursor' in spec.query.shape)
    throw new Error(`Provider query must not declare cursor; paging adds it: ${spec.id}`);
  const remote: RemoteReadDeclaration = { target: spec.target, identity: spec.identity };
  // `defineCapability` widens `remote` to optional; these capabilities always carry it.
  const declared = <C>(capability: C) =>
    capability as C & { readonly remote: RemoteReadDeclaration };
  const output = jsonSchema(remoteResultSchema(spec.item));
  const permission = { action: 'search', resourceType: spec.resourceType };
  const display = (label: string | undefined) => {
    const shown = {
      ...(label ? { label } : {}),
      ...(spec.display?.titleField ? { titleField: spec.display.titleField } : {}),
      ...(spec.display?.fields ? { fields: spec.display.fields } : {}),
    };
    return Object.keys(shown).length ? { display: shown } : {};
  };
  const search = declared(
    defineCapability({
      id: `${spec.id}.search` as `${Id}.search`,
      kind: 'query',
      description: spec.descriptions.search,
      // `extend` keeps the query strict; TypeScript loses the shape over the generic, so restate it.
      input: jsonSchema(
        spec.query.extend({
          cursor: remoteCursorSchema.optional(),
        }) as unknown as PagedQuery<Query>,
      ),
      output,
      permission,
      remote,
      ui: spec.ui?.search ?? { binding: `${spec.id}.search` },
      ...display(spec.display?.search),
    }),
  );
  const lookup = declared(
    defineCapability({
      id: `${spec.id}.lookup` as `${Id}.lookup`,
      kind: 'query',
      description: spec.descriptions.lookup,
      input: jsonSchema(lookupInput),
      output,
      permission,
      remote,
      ui: spec.ui?.lookup ?? { binding: `${spec.id}.lookup` },
      ...display(spec.display?.lookup),
    }),
  );
  return Object.freeze({
    id: spec.id,
    target: spec.target,
    identity: spec.identity,
    search,
    lookup,
    capabilities: [search, lookup] as const,
  });
}
export type DataProvider = ReturnType<typeof defineDataProvider>;
