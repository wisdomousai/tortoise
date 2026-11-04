import { useQuery } from '@tanstack/react-query';
import type { AnyCapability, CatalogOperation } from '@tortoise/contracts';
import { MAX_PAGE } from '@tortoise/contracts';
import { live, transport } from '@/lib/session';

type Row = Record<string, unknown>;

/** The records a reference field may name, keyed, with the field that titles each. */
export interface ReferenceList {
  readonly items: readonly Row[];
  readonly key: string;
  readonly titleField?: string;
  readonly loading: boolean;
  /** The title of the record with `id`, else the id itself. */
  title(id: unknown): string;
}

const empty = (loading: boolean): ReferenceList => ({
  items: [],
  key: 'id',
  loading,
  title: (id) => String(id ?? ''),
});

/** The generated list query of the collection whose records are the resource kind `kind`. */
function listOf(operations: readonly CatalogOperation[] | undefined, kind: string | undefined) {
  if (!kind) return undefined;
  return operations?.find(
    (operation) =>
      operation.kind === 'query' &&
      operation.display?.resource === kind &&
      'items' in ((operation.outputSchema.properties ?? {}) as object),
  );
}

/**
 * The records a reference field may name: the first page of the referenced collection's list,
 * read live through the catalog so the picker and the cells need no capability import. A kind
 * with no list the caller may read gives an empty list, and the cells show the key.
 */
export function useReferenceList(kind: string | undefined): ReferenceList {
  const catalog = useQuery({
    queryKey: ['contract'],
    queryFn: () => transport.catalog(),
    enabled: kind !== undefined,
    staleTime: Infinity,
  });
  const operation = listOf(catalog.data?.operations, kind);
  const capability = {
    id: operation?.id ?? 'none',
    kind: 'query',
    dependencies: operation?.dependencies ?? [],
  } as unknown as AnyCapability & { kind: 'query' };
  const list = useQuery({
    ...live.liveQueryOptions(capability, { limit: MAX_PAGE } as never),
    enabled: operation !== undefined,
  });
  if (!operation) return empty(kind !== undefined && catalog.isPending);
  const items = ((list.data as { items?: Row[] } | undefined)?.items ?? []) as Row[];
  const key = operation.display?.key ?? 'id';
  const titleField = operation.display?.titleField;
  const titles = new Map(items.map((item) => [String(item[key]), item]));
  return {
    items,
    key,
    ...(titleField ? { titleField } : {}),
    loading: list.isPending,
    title: (id) => {
      const record = titles.get(String(id ?? ''));
      const title = titleField && record ? record[titleField] : undefined;
      return title !== undefined && title !== null && title !== ''
        ? String(title)
        : String(id ?? '');
    },
  };
}
