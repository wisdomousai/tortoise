import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability } from '@agent-native/contracts';
import { ReportBody } from '@/components/assignment-reports';
import { GeneratedReportForm, type SubmitReport } from '@/components/my-assignments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };
type Sync = 'pending' | 'accepted' | 'rejected';
type Rejection = { code: string; message: string };

/** An assignment as a worklist's `assignment.list` returns it. */
export interface WorklistAssignment {
  id: string;
  kind: string;
  title: string;
  note?: string;
  brief: Record<string, unknown>;
  sentAt: number;
  open: boolean;
  done: boolean;
  doneSync?: Sync;
  reports: number;
  rejection?: Rejection;
}
/** A report as a worklist's `report.list` returns it. */
export interface WorklistReport {
  id: string;
  assignmentId: string;
  kind: string;
  subject?: string;
  body: Record<string, unknown>;
  reportedAt: number;
  sync: Sync;
  rejection?: Rejection;
}
/** One kind the worklist takes: its contract, the worklist's report command and optional views. */
export interface WorklistKind {
  /** The kind as `defineAssignmentKind` returns it. */
  kind: { id: string; title: string; subject?: string };
  /** The worklist's `<kind>Report` command. */
  report: Command;
  /** How the brief reads; its JSON when omitted. */
  brief?: (item: WorklistAssignment) => ReactNode;
  /** The application's own report form; fields generated from the report body when omitted. */
  form?: (item: WorklistAssignment, submit: SubmitReport) => ReactNode;
}

const syncVariant = { pending: 'secondary', accepted: 'outline', rejected: 'destructive' } as const;
const syncLabel = (sync: Sync, issuer: string) =>
  ({ pending: `Waiting for ${issuer}`, accepted: `At ${issuer}`, rejected: 'Refused' })[sync];
const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'CONFLICT') return 'The assignment takes no more reports.';
  return error instanceof Error ? error.message : 'The command failed.';
};

/** Where an assignment stands here: open, done and how the issuer took it, or closed there. */
function Standing({ item, issuer }: { item: WorklistAssignment; issuer: string }) {
  if (item.done)
    return item.doneSync === 'accepted' ? (
      <Badge variant="outline">Done</Badge>
    ) : (
      <Badge variant="secondary">Done, waiting for {issuer}</Badge>
    );
  if (item.doneSync === 'rejected') return <Badge variant="destructive">Done refused</Badge>;
  if (item.open) return <Badge variant="secondary">Open</Badge>;
  return <Badge variant="outline">Closed by {issuer}</Badge>;
}

function Item({
  item,
  kind,
  complete,
  issuer,
}: {
  item: WorklistAssignment;
  kind: WorklistKind | undefined;
  complete: Command;
  issuer: string;
}) {
  const [message, setMessage] = useState<string>();
  const [status, setStatus] = useState('');
  // One key per report until it is recorded: a retry after a lost answer records it once.
  const [reportKey, setReportKey] = useState(() => crypto.randomUUID());
  const run = async (command: Command, input: Record<string, unknown>, idempotencyKey?: string) => {
    setMessage(undefined);
    setStatus('');
    try {
      await client.command(command, input as never, idempotencyKey ? { idempotencyKey } : {});
      return true;
    } catch (error) {
      setMessage(refusal(error));
      return false;
    }
  };
  const submit: SubmitReport = async (body, subject) => {
    if (!kind) return false;
    const recorded = await run(
      kind.report,
      { assignmentId: item.id, ...(subject ? { subject } : {}), body },
      reportKey,
    );
    if (!recorded) return false;
    setReportKey(crypto.randomUUID());
    setStatus('Recorded');
    return true;
  };
  return (
    <li aria-label={item.title} className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.title}</span>
          <Standing item={item} issuer={issuer} />
        </div>
        {item.note && <p className="text-sm">{item.note}</p>}
        <p className="text-xs text-muted-foreground">
          {kind?.kind.title ?? item.kind}, sent {new Date(item.sentAt).toLocaleString()},{' '}
          {item.reports} reports here
        </p>
        {item.rejection && (
          <p className="text-sm text-destructive">
            {issuer} refused the done mark: {item.rejection.message}
          </p>
        )}
      </div>
      {kind?.brief ? (
        kind.brief(item)
      ) : (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(item.brief, null, 2)}
        </pre>
      )}
      {item.open && kind && !item.done && (
        <>
          {kind.form ? (
            kind.form(item, submit)
          ) : (
            <GeneratedReportForm item={item} kind={kind} submit={submit} />
          )}
          <Button size="sm" onClick={() => void run(complete, { id: item.id })}>
            Done
          </Button>
        </>
      )}
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </li>
  );
}

/** The worklist target's counts and when assignments last arrived. */
function Counts({ status, issuer }: { status: Query; issuer: string }) {
  const counts = useQuery(live.liveQueryOptions(status, {} as never)).data as
    { pending: number; accepted: number; rejected: number; lastSyncAt?: number } | undefined;
  if (!counts) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {counts.pending} waiting, {counts.accepted} at {issuer}, {counts.rejected} refused
      {counts.lastSyncAt
        ? `; assignments received ${new Date(counts.lastSyncAt).toLocaleString()}`
        : ''}
    </p>
  );
}

/**
 * The work an issuer sent here, live, and every report recorded for it. An open assignment takes
 * reports and Done; each goes to the issuer through the outbox as soon as it can be reached, and
 * how it stands there shows on it. A refused report keeps the issuer's reason and is not sent
 * again. `status` is the worklist target's status query, for the counts and the last feed.
 */
export function Worklist({
  title = 'Worklist',
  list,
  reports,
  complete,
  status,
  kinds,
  issuer = 'the issuer',
}: {
  title?: string;
  list: Query;
  reports: Query;
  complete: Command;
  status?: Query;
  kinds: readonly WorklistKind[];
  /** Who sends the work, for labels such as "Waiting for notes-assignments". */
  issuer?: string;
}) {
  const items =
    (
      useQuery(live.liveQueryOptions(list, {} as never)).data as
        { items: WorklistAssignment[] } | undefined
    )?.items ?? [];
  const recorded =
    (
      useQuery(live.liveQueryOptions(reports, {} as never)).data as
        { items: WorklistReport[] } | undefined
    )?.items ?? [];
  const kindOf = (id: string) => kinds.find((kind) => kind.kind.id === id);
  return (
    <section aria-label={title} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        {status && <Counts status={status} issuer={issuer} />}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing assigned here.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <Item
              key={item.id}
              item={item}
              kind={kindOf(item.kind)}
              complete={complete}
              issuer={issuer}
            />
          ))}
        </ul>
      )}
      <section aria-label="Reports here" className="space-y-3">
        <h3 className="text-sm font-medium">Reports here</h3>
        {recorded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports yet.</p>
        ) : (
          <ul className="space-y-3">
            {recorded.map((report) => (
              <li
                key={report.id}
                aria-label={`Report ${report.id}`}
                className="space-y-2 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {kindOf(report.kind)?.kind.title ?? report.kind}
                  </span>
                  <Badge variant={syncVariant[report.sync]}>{syncLabel(report.sync, issuer)}</Badge>
                  {report.subject && <Badge variant="outline">{report.subject}</Badge>}
                </div>
                <ReportBody body={report.body} />
                <p className="text-xs text-muted-foreground">
                  Recorded {new Date(report.reportedAt).toLocaleString()}
                  {report.rejection ? ` · ${report.rejection.message}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
