import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ClipboardCheck, Inbox } from 'lucide-react';
import { peerLinkOperations } from '@agent-native/peer-link/contracts';
import { AssignmentBoard, type AssigneeOption } from '@/components/assignment-board';
import { AssignmentReports, type ReportsKind } from '@/components/assignment-reports';
import { MyAssignments } from '@/components/my-assignments';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { assignmentOperations, review, reviewOperations } from '../contracts';
import { AcceptVerdict, NoteLink, NotePicker, PlaceOnNote, ScopeNotes } from './review-parts';
import { BriefNotes, VerdictForm, VerdictView } from './verdict';

type Peer = { id: string; label: string; application: string; revokedAt?: number };
type Assignee = { type: string; id: string };

/**
 * Members and the reviewer agent from the application, and connected peer applications from
 * the peer link. Only the workspace owner may list peers; for anyone else the list has none.
 */
function useAssignees(): AssigneeOption[] {
  const local = useQuery(live.liveQueryOptions(reviewOperations.assigneeList, {}));
  const peers = useQuery({
    ...live.liveQueryOptions(peerLinkOperations.list, {}),
    retry: false,
  });
  return [
    ...((local.data as { items: AssigneeOption[] } | undefined)?.items ?? []),
    ...((peers.data as { peers: Peer[] } | undefined)?.peers ?? [])
      .filter((peer) => peer.revokedAt === undefined)
      .map((peer) => ({ type: 'peer', id: peer.id, label: `${peer.label} (${peer.application})` })),
  ];
}
const nameOf = (assignees: readonly AssigneeOption[], assignee?: Assignee) =>
  assignee
    ? (assignees.find((option) => option.type === assignee.type && option.id === assignee.id)
        ?.label ?? `${assignee.type} ${assignee.id}`)
    : 'No assignee';
const notesOf = (scope: unknown) => (scope as { notes: string[] }).notes;

/** The reviewer's own comment, when they replaced the reporter's on accepting. */
function AcceptedComment({ report }: { report: { accepted?: { comment?: string } } }) {
  if (!report.accepted?.comment) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Added to the note instead: {report.accepted.comment}
    </p>
  );
}

/** A verdict reads as keep or revise with its comment, names its note, and is accepted into it. */
const reviewReports: ReportsKind = {
  kind: review,
  accept: assignmentOperations.reviewAccept,
  body: (report) => (
    <div className="space-y-1">
      <VerdictView body={report.body} />
      <AcceptedComment report={report} />
    </div>
  ),
  subject: (report) =>
    report.subject && (
      <Badge variant="outline">
        <NoteLink id={report.subject} />
      </Badge>
    ),
  place: (report, place) => <PlaceOnNote report={report} place={place} />,
  review: (report) => <AcceptVerdict report={report} />,
};

function Reports({ input }: { input?: Record<string, unknown> }) {
  return (
    <AssignmentReports
      list={assignmentOperations.reportList}
      discard={assignmentOperations.reportDiscard}
      place={assignmentOperations.reportPlace}
      kinds={[reviewReports]}
      {...(input ? { input } : {})}
    />
  );
}

function Board() {
  return (
    <div className="space-y-8">
      <AssignmentBoard
        title="Reviews"
        list={assignmentOperations.list}
        withdraw={assignmentOperations.withdraw}
        close={assignmentOperations.close}
        kinds={[
          {
            kind: review,
            create: assignmentOperations.reviewCreate,
            send: assignmentOperations.reviewSend,
            scope: (props) => <NotePicker {...props} />,
            summary: (assignment) => <ScopeNotes ids={notesOf(assignment.scope)} />,
          },
        ]}
        assignees={useAssignees()}
        aside={(assignment) => (
          <Link className="text-sm underline" to={`/reviews/${assignment.id}`}>
            Reports
          </Link>
        )}
      />
      <Reports />
    </div>
  );
}

/** One review: who has it, its notes and instructions, and the reports on it. */
function ReviewScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const assignees = useAssignees();
  const query = useQuery(live.liveQueryOptions(assignmentOperations.get, { id }));
  const assignment = query.data;
  if (query.isError) return <p className="text-muted-foreground">Review unavailable.</p>;
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{assignment?.title ?? 'Review'}</h1>
          {assignment && <Badge variant="outline">{assignment.stage}</Badge>}
        </div>
        {assignment && (
          <p className="text-sm text-muted-foreground">
            {nameOf(assignees, assignment.assignee)} · {assignment.reports} reports,{' '}
            {assignment.unreviewed} to review
          </p>
        )}
        {assignment?.note && <p className="text-sm">{assignment.note}</p>}
        {assignment && <ScopeNotes ids={notesOf(assignment.scope)} />}
      </header>
      <Reports input={{ assignmentId: id }} />
    </div>
  );
}

/** One report: its verdict, its note, who sent it and how it was reviewed. */
function ReportScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const query = useQuery(live.liveQueryOptions(assignmentOperations.reportGet, { id }));
  const report = query.data;
  if (query.isError) return <p className="text-muted-foreground">Report unavailable.</p>;
  if (!report) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Verdict</h1>
        <Badge variant="outline">{report.review}</Badge>
      </div>
      <p className="text-sm">
        On {report.subject ? <NoteLink id={report.subject} /> : 'no note yet'}, in{' '}
        <Link className="underline" to={`/reviews/${report.assignmentId}`}>
          its review
        </Link>
      </p>
      <VerdictView body={report.body} />
      <AcceptedComment report={report} />
      <p className="text-xs text-muted-foreground">
        Reported by {report.reportedBy}
        {report.runId ? ' in an agent run' : ''} at {new Date(report.reportedAt).toLocaleString()}
        {report.reviewedBy ? ` · reviewed by ${report.reviewedBy}` : ''}
        {report.reason ? ` · ${report.reason}` : ''}
      </p>
    </div>
  );
}

function Mine() {
  return (
    <MyAssignments
      title="My reviews"
      feed={assignmentOperations.feed}
      complete={assignmentOperations.complete}
      kinds={[
        {
          kind: review,
          report: assignmentOperations.reviewReport,
          brief: (item) => <BriefNotes brief={item.brief} />,
          form: (item, submit) => <VerdictForm item={item} submit={submit} />,
        },
      ]}
    />
  );
}

/** The review board with its reports, one review with its reports, one report, and my reviews. */
export const reviewRoutes = [
  { path: 'reviews', component: Board },
  { path: 'reviews/$id', component: ReviewScreen },
  { path: 'reports/$id', component: ReportScreen },
  { path: 'my-reviews', component: Mine },
];

export const reviewNavigation = [
  { to: '/reviews', label: 'Reviews', icon: ClipboardCheck },
  { to: '/my-reviews', label: 'My reviews', icon: Inbox },
];

export const reviewCapabilityScreens = [
  { prefix: 'assignment.review.report', to: '/my-reviews' },
  { prefix: 'assignment.complete', to: '/my-reviews' },
  { prefix: 'assignment.feed', to: '/my-reviews' },
  { prefix: 'assignment.', to: '/reviews' },
  { prefix: 'review.', to: '/reviews' },
];
