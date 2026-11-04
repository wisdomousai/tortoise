import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { listFilters, listSearches, listSortFields } from '@tortoise/contracts';
import type { AnyCapability, JsonObject } from '@tortoise/contracts';
import { useDebouncedValue } from '@tortoise/react/hooks';
import { CapabilityForm } from '@/components/capability-form';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeDialog } from '@/components/ui/native-dialog';
import { NativeSelect } from '@/components/ui/native-select';
import {
  displayLabels,
  formatBytes,
  formatDate,
  humanize,
  plainValue,
  propertyTypes,
  shownFields,
  statusTone,
  toneVariant,
  type Property,
  type ShownField,
} from '@/lib/fields';
import { useReferenceList } from '@/lib/references';
import { client, live } from '@/lib/session';
import { useScreens } from '../screens-context';

export { plainValue, recordFields } from '@/lib/fields';

type Row = Record<string, unknown>;
type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };

const PAGE = 25;

/** The title of the referenced record, or its key while the list loads or when it is not listed. */
function ReferenceValue({ kind, id }: { kind: string | undefined; id: unknown }) {
  const list = useReferenceList(kind);
  return <>{list.title(id)}</>;
}

/** A field value shown by its kind: a formatted date, a status badge, yes or no, a file's size. */
function Value({ field, value }: { field: ShownField; value: unknown }) {
  if (value === undefined || value === null)
    return <span className="text-muted-foreground">—</span>;
  switch (field.kind) {
    case 'date':
    case 'date-time':
      return <>{formatDate(value, field.kind)}</>;
    case 'status':
      return (
        <Badge variant={toneVariant(statusTone(String(value), field.tones))}>{String(value)}</Badge>
      );
    case 'boolean':
      return <>{value === true ? 'Yes' : value === false ? 'No' : plainValue(value)}</>;
    case 'reference':
      return <ReferenceValue kind={field.reference} id={value} />;
    case 'file': {
      const ref = value as { size?: number; mediaType?: string };
      return typeof ref.size === 'number'
        ? `${ref.mediaType ?? 'file'}, ${formatBytes(ref.size)}`
        : plainValue(value);
    }
    default:
      return <>{plainValue(value)}</>;
  }
}

/** A list filter as the screen edits it: the value is a string, empty when not applied. */
interface Filter {
  readonly name: string;
  readonly label: string;
  readonly choices: readonly string[];
  readonly type: string | undefined;
}

/** The equality filters a list declares, with their choices from the input schema. */
function filtersOf(list: Query): Filter[] {
  const properties = (list.input.jsonSchema.properties ?? {}) as Record<string, Property>;
  const labels = displayLabels(list);
  return listFilters(list).map((name) => {
    const { type, value } = propertyTypes(properties[name] ?? {});
    return {
      name,
      label: labels.get(name) ?? humanize(name),
      choices: value.enum ? value.enum.map(String) : type === 'boolean' ? ['true', 'false'] : [],
      type,
    };
  });
}

/** A filter's typed input value from the string the control holds. */
function filterValue(filter: Filter, raw: string): unknown {
  if (filter.type === 'boolean') return raw === 'true';
  if (filter.type === 'number' || filter.type === 'integer') return Number(raw);
  return raw;
}

/** A select for a filter with choices, else a text input. */
function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: Filter;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `filter-${filter.name}`;
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-muted-foreground">
        {filter.label}
      </Label>
      {filter.choices.length ? (
        <NativeSelect
          id={id}
          size="sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Any</option>
          {filter.choices.map((choice) => (
            <option key={choice} value={choice}>
              {filter.type === 'boolean' ? (choice === 'true' ? 'Yes' : 'No') : humanize(choice)}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={id}
          className="h-7 max-w-40"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

/**
 * A collection's list screen over its generated `list` query: the filters and sort the list
 * declares, a search box when it declares one, a server-paged table and a form for its create
 * command. Columns come from the list's display fields, else from the record schema, and render
 * by kind: dates formatted, a status as a badge with its tone, a reference by its title. A row
 * opens through `open`, else through the screen the application registers for the collection's
 * resource kind. Replace it with a purpose-built screen one route at a time; the instance still
 * scopes, filters and counts before paging.
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
  /** The screen that opens one row, for example `/items/$id`; `screens.resources` when omitted. */
  open?: (row: Row) => string;
}) {
  const navigate = useNavigate();
  const screens = useScreens();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const searchable = listSearches(list);
  const declaredFilters = filtersOf(list);
  const sortFields = listSortFields(list);
  const settledSearch = useDebouncedValue(search.trim());
  const settledFilters = useDebouncedValue(filters);
  const input: Record<string, unknown> = { offset, limit: PAGE };
  for (const filter of declaredFilters) {
    const raw = settledFilters[filter.name];
    if (raw) input[filter.name] = filterValue(filter, raw);
  }
  if (searchable && settledSearch) input.search = settledSearch;
  if (sortBy) Object.assign(input, { sortBy, sortDirection });
  const query = useQuery(live.liveQueryOptions(list, input as never));
  const data = query.data as { items: Row[]; total: number } | undefined;
  const declared = shownFields(list, true, 6);
  const fields = columns
    ? columns.map(
        (name) =>
          declared.find((field) => field.name === name) ??
          shownFields(list, true).find((field) => field.name === name) ?? {
            name,
            label: humanize(name),
            kind: 'text' as const,
            choices: [],
          },
      )
    : declared;
  // Rows are announced by the display title field, else a title or name, else the first field.
  const names = fields.map((field) => field.name);
  const key = list.display?.key ?? 'id';
  const labelField =
    list.display?.titleField ??
    names.find((name) => name === 'title' || name === 'name') ??
    names[0] ??
    key;
  const resource = list.display?.resource;
  const opens = open ?? (resource && screens.resources?.[resource] ? resource : undefined);
  const openRow = async (row: Row) => {
    const to =
      typeof opens === 'function'
        ? opens(row)
        : await screens.resources![opens!]!(String(row[key]));
    await navigate({ to });
  };
  const tableColumns: LiveColumn<Row>[] = fields.map((field) => ({
    id: field.name,
    header: field.label,
    cell: ({ row }) => <Value field={field} value={row.original[field.name]} />,
  }));
  const sortLabel = (name: string) =>
    declared.find((field) => field.name === name)?.label ?? humanize(name);
  const reset = () => setOffset(0);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {searchable && (
          <Input
            type="search"
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            className="max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              reset();
            }}
          />
        )}
      </header>
      {(declaredFilters.length > 0 || sortFields.length > 0) && (
        <div
          role="group"
          aria-label="Filters"
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          {declaredFilters.map((filter) => (
            <FilterControl
              key={filter.name}
              filter={filter}
              value={filters[filter.name] ?? ''}
              onChange={(value) => {
                setFilters({ ...filters, [filter.name]: value });
                reset();
              }}
            />
          ))}
          {sortFields.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor="sort-by" className="text-muted-foreground">
                Sort by
              </Label>
              <NativeSelect
                id="sort-by"
                size="sm"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value);
                  reset();
                }}
              >
                <option value="">Default</option>
                {sortFields.map((name) => (
                  <option key={name} value={name}>
                    {sortLabel(name)}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                disabled={!sortBy}
                onClick={() => {
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  reset();
                }}
              >
                {sortDirection === 'asc' ? '↑' : '↓'}
              </Button>
            </div>
          )}
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : `${title} unavailable.`}
        </p>
      )}
      <LiveDataTable
        columns={tableColumns}
        rows={data?.items ?? []}
        count={data?.total ?? 0}
        offset={offset}
        limit={PAGE}
        onOffset={setOffset}
        {...(opens ? { onRowOpen: (row: Row) => void openRow(row) } : {})}
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
 * Retire one record after the person confirms. The instance refuses the change when the record
 * has children or has changed; the refusal shows under the button.
 */
function RetireButton({
  retire,
  id,
  name,
  onRetired,
}: {
  retire: Command;
  id: string;
  name: string;
  onRetired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const label = retire.display?.label ?? 'Retire';
  const run = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(retire, { id } as never);
      setOpen(false);
      onRetired?.();
    } catch (error) {
      setOpen(false);
      setMessage(error instanceof Error ? error.message : 'The record was not retired.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <NativeDialog open={open} onOpenChange={setOpen} label={`${label} ${name}`}>
        <div className="space-y-4 p-5">
          <p className="text-sm">
            {label} {name}? It keeps its history and cannot be changed afterwards.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void run()}>
              {label}
            </Button>
          </div>
        </div>
      </NativeDialog>
    </div>
  );
}

/**
 * One record of a collection: its fields from the generated `get` query, in display order when
 * the query declares display fields, an edit form filled with the record's values, a form for its
 * move command, and a retire button that asks first. The heading names the record by its display
 * title field when there is one. A record the caller may not see is `NOT_FOUND` from the instance
 * and shows as unavailable; the instance refuses a change to a retired record.
 */
export function RecordScreen({
  title,
  get,
  update,
  move,
  retire,
  list,
  param = 'id',
}: {
  title: string;
  get: Query;
  update?: Command;
  /** A generated `move` command; its form takes the new parent's key. */
  move?: Command;
  /** A generated `retire` command. */
  retire?: Command;
  /** The list screen to return to after a retire, for example `/items`. */
  list?: string;
  /** The route parameter holding the record key, `$id` by default. */
  param?: string;
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as Record<string, string | undefined>;
  const id = params[param] ?? '';
  const query = useQuery(live.liveQueryOptions(get, { id } as never));
  const record = query.data as Row | undefined;
  const titleField = get.display?.titleField;
  const name = (titleField && record?.[titleField] ? String(record[titleField]) : '') || id;
  if (query.isError) return <p className="text-muted-foreground">{title} unavailable.</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {title} {name}
      </h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {shownFields(get, false).map((field) => (
          <div key={field.name} className="contents">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd>
              <Value field={field} value={record?.[field.name]} />
            </dd>
          </div>
        ))}
      </dl>
      {update && record && (
        <section aria-label={update.description ?? 'Update'} className="space-y-3">
          <h2 className="text-base font-medium">Edit</h2>
          {/* A changed record remounts the form, so it edits the latest values. */}
          <CapabilityForm
            key={JSON.stringify(record)}
            capability={update}
            fixed={{ id } as never}
            initial={record}
            submitLabel="Save"
          />
        </section>
      )}
      {move && record && (
        <section aria-label={move.description ?? 'Move'} className="space-y-3">
          <h2 className="text-base font-medium">Move</h2>
          <CapabilityForm capability={move} fixed={{ id } as never} submitLabel="Move" />
        </section>
      )}
      {retire && record && (
        <RetireButton
          retire={retire}
          id={id}
          name={name}
          {...(list ? { onRetired: () => void navigate({ to: list }) } : {})}
        />
      )}
    </div>
  );
}
