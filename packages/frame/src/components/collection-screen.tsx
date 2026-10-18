import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { AnyCapability, JsonObject } from '@agent-native/contracts';
import { CapabilityForm } from '@/components/capability-form';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { live } from '@/lib/session';

type Row = Record<string, unknown>;
type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };
type Property = { type?: string | string[]; enum?: unknown[] };

const PAGE = 25;
const humanize = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());

/** Scalar fields of the record a collection list or get returns, in schema order. */
export function recordFields(schema: JsonObject, list: boolean): string[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  const record = list
    ? (((properties.items as JsonObject | undefined)?.items ?? {}) as JsonObject)
    : schema;
  return Object.entries((record.properties ?? {}) as Record<string, Property>)
    .filter(([, property]) => {
      const types = Array.isArray(property.type) ? property.type : [property.type];
      return (
        property.enum !== undefined || types.some((type) => type !== 'object' && type !== 'array')
      );
    })
    .map(([name]) => name);
}

/** A forwarded record's delivery state; anything else as plain text. */
function Value({ name, value }: { name: string; value: unknown }) {
  if (value === undefined || value === null)
    return <span className="text-muted-foreground">—</span>;
  if (name === 'sync')
    return (
      <Badge
        variant={
          value === 'rejected' ? 'destructive' : value === 'accepted' ? 'secondary' : 'outline'
        }
      >
        {humanize(String(value))}
      </Badge>
    );
  return <>{String(value)}</>;
}

/**
 * A collection's list screen: a server-paged table over its generated `list` query, a search box
 * when the list declares one, and a form for its create command. Columns come from the record
 * schema, and a `sync` field renders as delivery state. Replace it with a purpose-built screen
 * one route at a time; the instance still scopes, filters and counts before paging.
 */
export function CollectionScreen({
  title,
  list,
  create,
  columns,
  open,
}: {
  title: string;
  list: Query;
  create?: Command;
  /** Fields to show; the record's scalar fields (at most six) when omitted. */
  columns?: readonly string[];
  /** The screen that opens one row, for example `/items/$id`. */
  open?: (row: Row) => string;
}) {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const searchable = 'search' in ((list.input.jsonSchema.properties ?? {}) as object);
  const input = { offset, limit: PAGE, ...(searchable && search ? { search } : {}) };
  const query = useQuery(live.liveQueryOptions(list, input as never));
  const data = query.data as { items: Row[]; total: number } | undefined;
  const fields = columns ?? recordFields(list.output.jsonSchema, true).slice(0, 6);
  // Rows are announced by their title or name when the record has one, else by the first field.
  const labelField =
    fields.find((name) => name === 'title' || name === 'name') ?? fields[0] ?? 'id';
  const tableColumns: LiveColumn<Row>[] = fields.map((name) => ({
    id: name,
    header: humanize(name),
    cell: ({ row }) => <Value name={name} value={row.original[name]} />,
  }));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {searchable && (
          <Input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            className="max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
        )}
      </header>
      <LiveDataTable
        columns={tableColumns}
        rows={data?.items ?? []}
        count={data?.total ?? 0}
        offset={offset}
        limit={PAGE}
        onOffset={setOffset}
        {...(open ? { onRowOpen: (row: Row) => void navigate({ to: open(row) }) } : {})}
        rowLabel={(row) => String(row[labelField] ?? '')}
      />
      {create && (
        <section aria-label={create.description ?? 'Create'} className="space-y-3">
          <h2 className="text-base font-medium">New</h2>
          <CapabilityForm capability={create} submitLabel="Create" />
        </section>
      )}
    </div>
  );
}

/**
 * One record of a collection: its fields from the generated `get` query and a form for its
 * update command with the record's key fixed. A record the caller may not see is `NOT_FOUND`
 * from the instance and shows as unavailable.
 */
export function RecordScreen({
  title,
  get,
  update,
  param = 'id',
}: {
  title: string;
  get: Query;
  update?: Command;
  /** The route parameter holding the record key, `$id` by default. */
  param?: string;
}) {
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const id = params[param] ?? '';
  const query = useQuery(live.liveQueryOptions(get, { id } as never));
  const record = query.data as Row | undefined;
  if (query.isError) return <p className="text-muted-foreground">{title} unavailable.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {title} {id}
      </h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {recordFields(get.output.jsonSchema, false).map((name) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{humanize(name)}</dt>
            <dd>
              <Value name={name} value={record?.[name]} />
            </dd>
          </div>
        ))}
      </dl>
      {update && record && (
        <section aria-label={update.description ?? 'Update'} className="space-y-3">
          <h2 className="text-base font-medium">Edit</h2>
          <CapabilityForm capability={update} fixed={{ id } as never} submitLabel="Save" />
        </section>
      )}
    </div>
  );
}
