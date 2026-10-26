import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability, JsonObject } from '@agent-native/contracts';
import { fieldsOf } from '@/components/capability-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };
type Field = ReturnType<typeof fieldsOf>[number];

/** An assignment sent to the signed-in person, as the feed lists it. */
export interface FeedItem {
  id: string;
  kind: string;
  title: string;
  note?: string;
  brief: Record<string, unknown>;
  sentAt: number;
}
/** Records one report on the item; resolves false and shows the refusal when the instance refuses. */
export type SubmitReport = (body: Record<string, unknown>, subject?: string) => Promise<boolean>;

/** One kind the person takes: its contract, its report command and optional views. */
export interface MyKind {
  /** The kind as `defineAssignmentKind` returns it. */
  kind: { id: string; title: string; subject?: string };
  report: Command;
  /** How the brief reads; its JSON when omitted. */
  brief?: (item: FeedItem) => ReactNode;
  /** The application's own report form; fields generated from the report body when omitted. */
  form?: (item: FeedItem, submit: SubmitReport) => ReactNode;
}

const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'CONFLICT') return 'The assignment takes no more reports.';
  return error instanceof Error ? error.message : 'The command failed.';
};

function typed(fields: Field[], values: Record<string, string>) {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name] ?? '';
    if (raw === '' && !field.required) continue;
    if (field.kind === 'number') body[field.name] = Number(raw.replace(',', '.'));
    else if (field.kind === 'boolean') body[field.name] = raw === 'true';
    else if (field.kind === 'json') body[field.name] = JSON.parse(raw || 'null');
    else body[field.name] = raw;
  }
  return body;
}

/**
 * The report body's fields, generated from the report command's input schema, and the subject
 * when the kind names one. The worklist's screen uses it too.
 */
export function GeneratedReportForm({
  item,
  kind,
  submit,
}: {
  item: { id: string; title: string };
  kind: { kind: MyKind['kind']; report: Command };
  submit: SubmitReport;
}) {
  const schema = (kind.report.input.jsonSchema.properties as Record<string, JsonObject>).body!;
  const fields = fieldsOf(schema);
  const [values, setValues] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState('');
  const [invalid, setInvalid] = useState<string>();
  const id = (name: string) => `${item.id}-${name}`;
  const set = (name: string) => (value: string) => setValues({ ...values, [name]: value });
  return (
    <form
      aria-label={`Report on ${item.title}`}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        let body: Record<string, unknown>;
        try {
          body = typed(fields, values);
        } catch {
          return setInvalid('A field holds JSON that does not parse.');
        }
        setInvalid(undefined);
        void submit(body, subject || undefined).then((done) => {
          if (!done) return;
          setValues({});
          setSubject('');
        });
      }}
    >
      {kind.kind.subject && (
        <div className="space-y-1">
          <Label htmlFor={id('subject')}>
            {kind.kind.subject} <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={id('subject')}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
      )}
      {fields.map((field) => (
        <div
          key={field.name}
          className={field.kind === 'json' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}
        >
          <Label htmlFor={id(field.name)}>{field.label}</Label>
          {field.kind === 'choice' || field.kind === 'boolean' ? (
            <NativeSelect
              id={id(field.name)}
              value={values[field.name] ?? ''}
              onChange={(event) => set(field.name)(event.target.value)}
            >
              <option value="">Select…</option>
              {(field.kind === 'boolean' ? ['true', 'false'] : field.choices).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </NativeSelect>
          ) : field.kind === 'json' ? (
            <Textarea
              id={id(field.name)}
              className="font-mono"
              value={values[field.name] ?? ''}
              onChange={(event) => set(field.name)(event.target.value)}
            />
          ) : (
            <Input
              id={id(field.name)}
              value={values[field.name] ?? ''}
              onChange={(event) => set(field.name)(event.target.value)}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary">
          Report
        </Button>
        {invalid && (
          <span role="alert" className="text-sm text-destructive">
            {invalid}
          </span>
        )}
      </div>
    </form>
  );
}

function Item({
  item,
  kind,
  complete,
}: {
  item: FeedItem;
  kind: MyKind | undefined;
  complete: Command;
}) {
  const [message, setMessage] = useState<string>();
  const [status, setStatus] = useState('');
  // One ID per report: a retry after a lost answer repeats it, and the instance keeps one copy.
  const [reportId, setReportId] = useState(() => crypto.randomUUID());
  const run = async (command: Command, input: Record<string, unknown>) => {
    setMessage(undefined);
    setStatus('');
    try {
      await client.command(command, input as never);
      return true;
    } catch (error) {
      setMessage(refusal(error));
      return false;
    }
  };
  const submit: SubmitReport = async (body, subject) => {
    if (!kind) return false;
    const done = await run(kind.report, {
      id: reportId,
      assignmentId: item.id,
      ...(subject ? { subject } : {}),
      body,
    });
    if (!done) return false;
    setReportId(crypto.randomUUID());
    setStatus('Reported');
    return true;
  };
  return (
    <li aria-label={item.title} className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="font-medium">{item.title}</p>
        {item.note && <p className="text-sm">{item.note}</p>}
        <p className="text-xs text-muted-foreground">
          {kind?.kind.title ?? item.kind}, sent {new Date(item.sentAt).toLocaleString()}
        </p>
      </div>
      {kind?.brief ? (
        kind.brief(item)
      ) : (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(item.brief, null, 2)}
        </pre>
      )}
      {kind &&
        (kind.form ? (
          kind.form(item, submit)
        ) : (
          <GeneratedReportForm item={item} kind={kind} submit={submit} />
        ))}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void run(complete, { id: item.id })}>
          Done
        </Button>
        {message ? (
          <span role="alert" className="text-sm text-destructive">
            {message}
          </span>
        ) : (
          <span role="status" className="text-sm text-muted-foreground">
            {status}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * The assignments sent to the signed-in person, live, each with its brief, a report form and
 * Done. A report is recorded under an ID the screen chose, so a retry keeps one copy; after Done
 * the assignment leaves the list. The instance matches the assignee itself, so a person sees and
 * reports on their own work only.
 */
export function MyAssignments({
  title = 'My assignments',
  feed,
  complete,
  kinds,
}: {
  title?: string;
  feed: Query;
  complete: Command;
  kinds: readonly MyKind[];
}) {
  const query = useQuery(live.liveQueryOptions(feed, {} as never));
  const items = (query.data as { items: FeedItem[] } | undefined)?.items ?? [];
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-base font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <Item
              key={item.id}
              item={item}
              kind={kinds.find((kind) => kind.kind.id === item.kind)}
              complete={complete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
