import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability } from '@agent-native/contracts';
import { CapabilityForm } from '@/components/capability-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };

export interface AssignmentReport {
  id: string;
  assignmentId: string;
  kind: string;
  subject?: string;
  body: Record<string, unknown>;
  reportedBy: string;
  runId?: string;
  reportedAt: number;
  review: 'new' | 'accepted' | 'discarded';
  reviewedBy?: string;
  reason?: string;
  /** What the reviewer gave on accepting it, in the kind's accept shape. */
  accepted?: Record<string, unknown>;
}

/** Places a report on a subject; resolves false and shows the refusal when the instance refuses. */
export type PlaceReport = (subject: string) => Promise<boolean>;

/** One kind's reports: its contract, its accept command and optional views. */
export interface ReportsKind {
  /** The kind as `defineAssignmentKind` returns it. */
  kind: { id: string; title: string; subject?: string };
  accept: Command;
  /** How a report body reads; its fields as a list when omitted. */
  body?: (report: AssignmentReport) => ReactNode;
  /** How a placed report names its subject, such as a link to the record; its key when omitted. */
  subject?: (report: AssignmentReport) => ReactNode;
  /** The input that places a report on a subject; a field for the record's key when omitted. */
  place?: (report: AssignmentReport, place: PlaceReport) => ReactNode;
  /** The reviewer's input on accepting; the accept command's generated form when omitted. */
  review?: (report: AssignmentReport) => ReactNode;
}

const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'FORBIDDEN') return 'You may not do this.';
  if (code === 'CONFLICT') return 'The report was reviewed already. Nothing was changed.';
  return error instanceof Error ? error.message : 'The command failed.';
};
const isBlob = (value: unknown): value is { mediaType: string } =>
  typeof value === 'object' && value !== null && 'digest' in value && 'mediaType' in value;
const shown = (value: unknown) =>
  typeof value === 'string'
    ? value
    : isBlob(value)
      ? `File (${value.mediaType})`
      : Array.isArray(value) && value.every(isBlob)
        ? `${value.length} files`
        : JSON.stringify(value);

/** A report body as a list of its fields. */
export function ReportBody({ body }: { body: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
      {Object.entries(body).map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd>{shown(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportItem({
  report,
  kind,
  discard,
  place,
}: {
  report: AssignmentReport;
  kind: ReportsKind | undefined;
  discard: Command;
  place?: Command;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [subject, setSubject] = useState('');
  const act = async (command: Command, input: Record<string, unknown>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(command, input as never);
      return true;
    } catch (error) {
      setMessage(refusal(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const placeOn: PlaceReport = (on) =>
    place ? act(place, { id: report.id, subject: on }) : Promise.resolve(false);
  const open = report.review === 'new';
  return (
    <li aria-label={`Report ${report.id}`} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{kind?.kind.title ?? report.kind}</span>
        <Badge variant={open ? 'secondary' : 'outline'}>{report.review}</Badge>
        {report.subject ? (
          kind?.subject ? (
            kind.subject(report)
          ) : (
            <Badge variant="outline">{report.subject}</Badge>
          )
        ) : kind?.kind.subject ? (
          <Badge variant="destructive">Not placed</Badge>
        ) : null}
      </div>
      {kind?.body ? kind.body(report) : <ReportBody body={report.body} />}
      <p className="text-xs text-muted-foreground">
        Reported by {report.reportedBy}
        {report.runId ? ' in an agent run' : ''} at {new Date(report.reportedAt).toLocaleString()}
        {report.reviewedBy ? ` · reviewed by ${report.reviewedBy}` : ''}
        {report.reason ? ` · ${report.reason}` : ''}
      </p>
      {open && place && kind?.kind.subject && kind.place && kind.place(report, placeOn)}
      {open && place && kind?.kind.subject && !kind.place && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void placeOn(subject);
          }}
        >
          <Input
            aria-label={`${kind.kind.subject} for report ${report.id}`}
            className="max-w-xs"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <Button size="sm" variant="outline" type="submit" disabled={busy || !subject}>
            Place
          </Button>
        </form>
      )}
      {open && kind && (
        <div className="space-y-2">
          {kind.review ? (
            kind.review(report)
          ) : (
            <CapabilityForm
              capability={kind.accept}
              fixed={{ id: report.id }}
              submitLabel="Accept"
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(discard, { id: report.id })}
          >
            Discard
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * Reports, live, newest first, each with its body, who reported it and its review state. A new
 * report can be placed on a subject, discarded, or accepted with the reviewer's input; accepting
 * runs the kind's accept command as the signed-in person, so the application writes its records
 * in the same transaction and a refusal leaves the report new. `input` filters the list, for
 * example to one assignment.
 */
export function AssignmentReports({
  title = 'Reports',
  list,
  discard,
  place,
  kinds,
  input = {},
}: {
  title?: string;
  list: Query;
  discard: Command;
  /** The place command; omitted when no kind's reports name a subject. */
  place?: Command;
  kinds: readonly ReportsKind[];
  /** The report list's filters: assignment, kind, review state, subject. */
  input?: Record<string, unknown>;
}) {
  const query = useQuery(live.liveQueryOptions(list, { limit: 100, ...input } as never));
  const data = query.data as { items: AssignmentReport[]; total: number } | undefined;
  const items = data?.items ?? [];
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-base font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reports.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((report) => (
            <ReportItem
              key={report.id}
              report={report}
              kind={kinds.find((kind) => kind.kind.id === report.kind)}
              discard={discard}
              {...(place ? { place } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
