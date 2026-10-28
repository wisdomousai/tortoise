import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { AnyCapability, DisplayDeclaration, JsonObject } from '@agent-native/contracts';
import { CapabilityForm } from '@/components/capability-form';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';

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

/** The fields to show and their headings: the capability's display fields, else the schema's. */
function shownFields(capability: AnyCapability, list: boolean, limit?: number) {
  const display: DisplayDeclaration | undefined = capability.display;
  if (display?.fields)
    return display.fields.map((field) => ({
      name: field.name,
      label: field.label ?? humanize(field.name),
    }));
  const names = recordFields(capability.output.jsonSchema, list);
  return (limit ? names.slice(0, limit) : names).map((name) => ({ name, label: humanize(name) }));
}

/**
 * A field value as plain text: a list of scalars joined, a list of records counted, and a record
 * as JSON, never "[object Object]".
 */
export function plainValue(value: unknown): string {
  if (Array.isArray(value))
    return value.every((item) => item === null || typeof item !== 'object')
      ? value.join(', ')
      : `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
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
  return <>{plainValue(value)}</>;
}

/**
 * A collection's list screen: a server-paged table over its generated `list` query, a search box
 * when the list declares one, and a form for its create command. Columns come from the list's
 * display fields, else from the record schema, and a `sync` field renders as delivery state.
 * Replace it with a purpose-built screen one route at a time; the instance still scopes, filters
 * and counts before paging.
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
  /** Fields to show; the display fields, else the record's scalar fields (at most six). */
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
  const declared = shownFields(list, true, 6);
  const fields = columns
    ? columns.map(
        (name) => declared.find((field) => field.name === name) ?? { name, label: humanize(name) },
      )
    : declared;
  // Rows are announced by the display title field, else a title or name, else the first field.
  const names = fields.map((field) => field.name);
  const labelField =
    list.display?.titleField ??
    names.find((name) => name === 'title' || name === 'name') ??
    names[0] ??
    'id';
  const tableColumns: LiveColumn<Row>[] = fields.map(({ name, label }) => ({
    id: name,
    header: label,
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

/** Retire one record: a button, and the instance's refusal when it has children or changed. */
function RetireButton({ retire, id }: { retire: Command; id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const run = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(retire, { id } as never);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The record was not retired.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
        {retire.display?.label ?? 'Retire'}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * One record of a collection: its fields from the generated `get` query, in display order when
 * the query declares display fields, and forms for its update and move commands with the record's
 * key fixed, and a retire button. The heading names the record by its display title field when
 * there is one. A record the caller may not see is `NOT_FOUND` from the instance and shows as
 * unavailable; the instance refuses a change to a retired record.
 */
export function RecordScreen({
  title,
  get,
  update,
  move,
  retire,
  param = 'id',
}: {
  title: string;
  get: Query;
  update?: Command;
  /** A generated `move` command; its form takes the new parent's key. */
  move?: Command;
  /** A generated `retire` command. */
  retire?: Command;
  /** The route parameter holding the record key, `$id` by default. */
  param?: string;
}) {
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const id = params[param] ?? '';
  const query = useQuery(live.liveQueryOptions(get, { id } as never));
  const record = query.data as Row | undefined;
  const titleField = get.display?.titleField;
  if (query.isError) return <p className="text-muted-foreground">{title} unavailable.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {title} {(titleField && record?.[titleField] ? String(record[titleField]) : '') || id}
      </h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {shownFields(get, false).map(({ name, label }) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
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
      {move && record && (
        <section aria-label={move.description ?? 'Move'} className="space-y-3">
          <h2 className="text-base font-medium">Move</h2>
          <CapabilityForm capability={move} fixed={{ id } as never} submitLabel="Move" />
        </section>
      )}
      {retire && record && <RetireButton retire={retire} id={id} />}
    </div>
  );
}
