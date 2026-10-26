import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { AnyCapability, CollectionTreeInput } from '@agent-native/contracts';
import { CapabilityForm } from '@/components/capability-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live } from '@/lib/session';

type Row = Record<string, unknown> & { depth: number };
type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };

/** Records the collection's list finds for `text`, flat, in the list's order. */
function Found({
  search,
  text,
  row,
}: {
  search: Query;
  text: string;
  row: (record: Row) => ReactNode;
}) {
  const query = useQuery(live.liveQueryOptions(search, { search: text, limit: 50 } as never));
  const data = query.data as { items: Record<string, unknown>[]; total: number } | undefined;
  if (!data) return null;
  if (!data.items.length) return <p className="text-sm text-muted-foreground">No matches.</p>;
  return (
    <ul aria-label="Matches" className="divide-y rounded-xl border bg-card">
      {data.items.map((record) => row({ ...record, depth: 0 }))}
    </ul>
  );
}

/**
 * A tree collection depth first from its generated `tree` query, each record indented by its
 * depth and named by the query's display title field. `aside` renders per-record badges or
 * actions, `open` the screen of one record, `search` a box over the generated list's search, and
 * `create` a form for the generated create command. The instance scopes the tree, so a record
 * whose parent the caller cannot see starts its own branch, and `total` beyond the shown records
 * says the tree was cut at the query's limit.
 */
export function CollectionTree({
  title,
  tree,
  input = {},
  open,
  aside,
  search,
  create,
  empty = 'Nothing here yet.',
}: {
  title: string;
  tree: Query;
  /** The tree query's input: a root, a depth, retired records. */
  input?: CollectionTreeInput;
  /** The screen that opens one record, for example `/places/<key>`. */
  open?: (row: Row) => string;
  aside?: (row: Row) => ReactNode;
  /** A generated list that declares `search`; matches replace the tree while there is text. */
  search?: Query;
  create?: Command;
  empty?: string;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const query = useQuery(live.liveQueryOptions(tree, input as never));
  const data = query.data as { items: Row[]; total: number } | undefined;
  const items = data?.items ?? [];
  const key = tree.display?.key ?? 'id';
  const name = (row: Row) => String(row[tree.display?.titleField ?? key] ?? row[key] ?? '');
  const row = (record: Row) => (
    <li
      key={String(record[key])}
      aria-level={record.depth + 1}
      className="flex flex-wrap items-center justify-between gap-2 py-2 pr-3"
      style={{ paddingLeft: `${0.75 + record.depth * 1.25}rem` }}
    >
      {open ? (
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => void navigate({ to: open(record) })}
        >
          {name(record)}
        </Button>
      ) : (
        <span className="text-sm">{name(record)}</span>
      )}
      {aside && <div className="flex items-center gap-2">{aside(record)}</div>}
    </li>
  );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {search && (
          <Input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            className="max-w-xs"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </header>
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {search && text ? (
        <Found search={search} text={text} row={row} />
      ) : items.length ? (
        <ul aria-label={title} className="divide-y rounded-xl border bg-card">
          {items.map(row)}
        </ul>
      ) : (
        data && <p className="text-sm text-muted-foreground">{empty}</p>
      )}
      {!text && data && data.total > items.length && (
        <p className="text-sm text-muted-foreground">
          Showing {items.length} of {data.total}. Open a record to see its branch.
        </p>
      )}
      {create && (
        <section aria-label={create.description ?? 'Create'} className="space-y-3">
          <h2 className="text-base font-medium">New</h2>
          <CapabilityForm capability={create} submitLabel="Create" />
        </section>
      )}
    </div>
  );
}
