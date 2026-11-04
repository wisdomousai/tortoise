import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { Worklist, type WorklistReport } from '@/components/worklist';
import { live } from '@/lib/session';
import { sampling, worklistOperations } from '../contracts';
import { BriefRound, SampleForm, SampleTransformer, SampleView } from './round';
import { formatDate } from '@/lib/fields';

const ISSUER = 'the oil lab';

function Rounds() {
  return (
    <Worklist
      title="Sampling rounds to do"
      list={worklistOperations.assignmentList}
      reports={worklistOperations.reportList}
      complete={worklistOperations.complete}
      status={worklistOperations.status}
      kinds={[
        {
          kind: sampling,
          report: worklistOperations.samplingReport,
          brief: (item) => <BriefRound brief={item.brief} />,
          form: (item, submit) => <SampleForm item={item} submit={submit} />,
          body: (report) => <SampleView body={report.body} />,
          subject: (report) => <SampleTransformer subject={report.subject} />,
        },
      ]}
      issuer={ISSUER}
    />
  );
}

/** One round held here: its substation and transformers, and the samples recorded for it. */
function RoundScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const query = useQuery(live.liveQueryOptions(worklistOperations.assignmentGet, { id }));
  const reports = useQuery(
    live.liveQueryOptions(worklistOperations.reportList, { assignmentId: id }),
  );
  const assignment = query.data;
  if (query.isError) return <p className="text-muted-foreground">Sampling round unavailable.</p>;
  if (!assignment) return null;
  const recorded: WorklistReport[] = reports.data?.items ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{assignment.title}</h1>
        <p className="text-sm text-muted-foreground">
          Sent {formatDate(assignment.sentAt)}
          {assignment.done ? ', done here' : assignment.open ? '' : `, closed by ${ISSUER}`}
        </p>
        {assignment.note && <p className="text-sm">{assignment.note}</p>}
      </header>
      <BriefRound brief={assignment.brief} />
      <section aria-label="Samples" className="space-y-2">
        <h2 className="text-base font-medium">Samples</h2>
        {recorded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No samples yet.</p>
        ) : (
          <ul className="space-y-2">
            {recorded.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center gap-2">
                <SampleTransformer subject={report.subject} />
                <SampleView body={report.body} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The rounds held here with their samples, and one round. */
export const roundRoutes = [
  { path: 'rounds', component: Rounds },
  { path: 'rounds/$id', component: RoundScreen },
];

export const roundNavigation = [{ to: '/rounds', label: 'Sampling rounds', icon: Inbox }];
export const roundCapabilityScreens = [{ prefix: 'worklist.', to: '/rounds' }];
