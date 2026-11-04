import { formatDate } from '@/lib/fields';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Inbox, Route } from 'lucide-react';
import { peerLinkOperations } from '@tortoise/peer-link/contracts';
import { AssignmentBoard, type AssigneeOption } from '@/components/assignment-board';
import { AssignmentReports, type ReportsKind } from '@/components/assignment-reports';
import { MyAssignments } from '@/components/my-assignments';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { assignmentOperations, sampling, samplingOperations } from '../contracts';
import {
  AcceptSample,
  LinkToTransformer,
  ScopeTransformers,
  TransformerPicker,
} from './round-parts';
import { InstructionsRound, SampleForm, SampleView } from './round';

type Peer = { id: string; label: string; application: string; revokedAt?: number };
type Assignee = { type: string; id: string };

/**
 * Members from the application, and connected peer applications from the peer link. Only the
 * local user may list peers; for anyone else the list has none.
 */
function useAssignees(): AssigneeOption[] {
  const local = useQuery(live.liveQueryOptions(samplingOperations.assigneeList, {}));
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

/** The method the technician assigned on accepting, when they gave one. */
function AcceptedMethod({ report }: { report: { accepted?: { method?: string } } }) {
  if (!report.accepted?.method) return null;
  return <p className="text-sm text-muted-foreground">Test method: {report.accepted.method}</p>;
}

/** A report reads as a sample with its description, names its transformer, and becomes a test request. */
const sampleReports: ReportsKind = {
  kind: sampling,
  accept: assignmentOperations.samplingAccept,
  body: (report) => (
    <div className="space-y-1">
      <SampleView body={report.body} />
      <AcceptedMethod report={report} />
    </div>
  ),
  subject: (report) => report.subject && <Badge variant="outline">{report.subject}</Badge>,
  link: (report, link) => <LinkToTransformer report={report} link={link} />,
  review: (report) => <AcceptSample report={report} />,
};

function Reports({ input }: { input?: Record<string, unknown> }) {
  return (
    <AssignmentReports
      list={assignmentOperations.reportList}
      discard={assignmentOperations.reportDiscard}
      link={assignmentOperations.reportLink}
      kinds={[sampleReports]}
      {...(input ? { input } : {})}
    />
  );
}

function Board() {
  return (
    <div className="space-y-8">
      <AssignmentBoard
        title="Sampling rounds"
        list={assignmentOperations.list}
        withdraw={assignmentOperations.withdraw}
        close={assignmentOperations.close}
        kinds={[
          {
            kind: sampling,
            create: assignmentOperations.samplingCreate,
            send: assignmentOperations.samplingSend,
            scope: (props) => <TransformerPicker {...props} />,
            summary: (assignment) => <ScopeTransformers scope={assignment.scope} />,
          },
        ]}
        assignees={useAssignees()}
        aside={(assignment) => (
          <Link className="text-sm underline" to={`/rounds/${assignment.id}`}>
            Reports
          </Link>
        )}
      />
      <Reports />
    </div>
  );
}

/** One round: who has it, its substation and transformers, and the reports on it. */
function RoundScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const assignees = useAssignees();
  const query = useQuery(live.liveQueryOptions(assignmentOperations.get, { id }));
  const assignment = query.data;
  if (query.isError) return <p className="text-muted-foreground">Sampling round unavailable.</p>;
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{assignment?.title ?? 'Sampling round'}</h1>
          {assignment && <Badge variant="outline">{assignment.stage}</Badge>}
        </div>
        {assignment && (
          <p className="text-sm text-muted-foreground">
            {nameOf(assignees, assignment.assignee)} · {assignment.reports} reports,{' '}
            {assignment.unreviewed} to review
          </p>
        )}
        {assignment?.note && <p className="text-sm">{assignment.note}</p>}
        {assignment && <ScopeTransformers scope={assignment.scope} />}
      </header>
      <Reports input={{ assignmentId: id }} />
    </div>
  );
}

/** One report: its sample, its transformer, who sent it and how it was reviewed. */
function ReportScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const query = useQuery(live.liveQueryOptions(assignmentOperations.reportGet, { id }));
  const report = query.data;
  if (query.isError) return <p className="text-muted-foreground">Report unavailable.</p>;
  if (!report) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Sample report</h1>
        <Badge variant="outline">{report.review}</Badge>
      </div>
      <p className="text-sm">
        From {report.subject ?? 'no transformer yet'}, in{' '}
        <Link className="underline" to={`/rounds/${report.assignmentId}`}>
          its round
        </Link>
      </p>
      <SampleView body={report.body} />
      <AcceptedMethod report={report} />
      <p className="text-xs text-muted-foreground">
        Reported by {report.reportedBy} at {formatDate(report.reportedAt)}
        {report.reviewedBy ? ` · reviewed by ${report.reviewedBy}` : ''}
        {report.reason ? ` · ${report.reason}` : ''}
      </p>
    </div>
  );
}

function Mine() {
  return (
    <MyAssignments
      title="My rounds"
      inbound={assignmentOperations.inbound}
      complete={assignmentOperations.complete}
      kinds={[
        {
          kind: sampling,
          report: assignmentOperations.samplingReport,
          instructions: (item) => <InstructionsRound instructions={item.instructions} />,
          form: (item, submit) => <SampleForm item={item} submit={submit} />,
        },
      ]}
    />
  );
}

/** The round board with its reports, one round with its reports, one report, and my rounds. */
export const roundRoutes = [
  { path: 'rounds', component: Board },
  { path: 'rounds/$id', component: RoundScreen },
  { path: 'reports/$id', component: ReportScreen },
  { path: 'my-rounds', component: Mine },
];

export const roundNavigation = [
  { to: '/rounds', label: 'Sampling rounds', icon: Route },
  { to: '/my-rounds', label: 'My rounds', icon: Inbox },
];

export const roundCapabilityScreens = [
  { prefix: 'assignment.sampling.report', to: '/my-rounds' },
  { prefix: 'assignment.complete', to: '/my-rounds' },
  { prefix: 'assignment.inbound', to: '/my-rounds' },
  { prefix: 'assignment.', to: '/rounds' },
  { prefix: 'sampling.', to: '/rounds' },
];
