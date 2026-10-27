import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { Worklist, type WorklistReport } from '@/components/worklist';
import { live } from '@/lib/session';
import { review, worklistOperations } from '../contracts';
import { BriefNotes, BriefSubject, VerdictForm, VerdictView } from './verdict';

function Reviews() {
  return (
    <Worklist
      title="Reviews to do"
      list={worklistOperations.assignmentList}
      reports={worklistOperations.reportList}
      complete={worklistOperations.complete}
      status={worklistOperations.status}
      kinds={[
        {
          kind: review,
          report: worklistOperations.reviewReport,
          brief: (item) => <BriefNotes brief={item.brief} />,
          form: (item, submit) => <VerdictForm item={item} submit={submit} />,
          body: (report) => <VerdictView body={report.body} />,
          subject: (report) => <BriefSubject report={report} />,
        },
      ]}
      issuer="notes-assignments"
    />
  );
}

/** One review held here: its instructions and notes, and the verdicts recorded for it. */
function ReviewScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const query = useQuery(live.liveQueryOptions(worklistOperations.assignmentGet, { id }));
  const reports = useQuery(
    live.liveQueryOptions(worklistOperations.reportList, { assignmentId: id }),
  );
  const assignment = query.data;
  if (query.isError) return <p className="text-muted-foreground">Review unavailable.</p>;
  if (!assignment) return null;
  const recorded: WorklistReport[] = reports.data?.items ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{assignment.title}</h1>
        <p className="text-sm text-muted-foreground">
          Sent {new Date(assignment.sentAt).toLocaleString()}
          {assignment.done ? ', done here' : assignment.open ? '' : ', closed by notes-assignments'}
        </p>
        {assignment.note && <p className="text-sm">{assignment.note}</p>}
      </header>
      <BriefNotes brief={assignment.brief} />
      <section aria-label="Verdicts" className="space-y-2">
        <h2 className="text-base font-medium">Verdicts</h2>
        {recorded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verdicts yet.</p>
        ) : (
          <ul className="space-y-2">
            {recorded.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center gap-2">
                <BriefSubject report={report} />
                <VerdictView body={report.body} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The reviews held here with their reports, and one review. */
export const reviewRoutes = [
  { path: 'reviews', component: Reviews },
  { path: 'reviews/$id', component: ReviewScreen },
];

export const reviewNavigation = [{ to: '/reviews', label: 'Reviews', icon: Inbox }];
export const reviewCapabilityScreens = [{ prefix: 'worklist.', to: '/reviews' }];
