import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { AssignmentBoard, type AssigneeOption } from '@/components/assignment-board';
import { AssignmentReports, type AssignmentReport } from '@/components/assignment-reports';
import { RecordScreen } from '@/components/collection-screen';
import { MyAssignments, type FeedItem, type SubmitReport } from '@/components/my-assignments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { live } from '@/lib/session';
import { assignmentOperations, operations } from '../contracts';
import { cycleCount } from '../contracts/cycle-count-assignment';

const board = '/assignments/cycle-counts';
const words = (value: string) => value.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A count's brief and one report's body, as the cycle count kind declares them. */
interface Brief {
  bin: string;
  tools: { assetTag: string; status: string }[];
}
interface Count {
  found: string[];
  missing: string[];
}

/** The bin to count, typed or picked from the bins of the listed tools. */
function BinPicker({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const query = useQuery(live.liveQueryOptions(operations.toolList, { limit: 100 }));
  const bins = [...new Set(query.data?.items.map((tool) => tool.bin))].sort();
  return (
    <div className="space-y-1">
      <Label htmlFor="cycle-count-bin">Bin</Label>
      <Input
        id="cycle-count-bin"
        className="max-w-40"
        list="cycle-count-bins"
        value={(value as { bin?: string }).bin ?? ''}
        onChange={(event) => onChange({ bin: event.target.value })}
      />
      <datalist id="cycle-count-bins">
        {bins.map((bin) => (
          <option key={bin} value={bin} />
        ))}
      </datalist>
    </div>
  );
}

function Board() {
  const assignees = useQuery(live.liveQueryOptions(operations.assigneeList, {}));
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Cycle counts</h1>
      <p className="text-sm text-muted-foreground">
        Send an attendant to count one bin. Accepting their report sets each missing tool to missing
        and each found tool that was missing back to available.
      </p>
      <AssignmentBoard
        title="Counts"
        list={assignmentOperations.list}
        withdraw={assignmentOperations.withdraw}
        close={assignmentOperations.close}
        input={{ kind: cycleCount.id }}
        kinds={[
          {
            kind: cycleCount,
            create: assignmentOperations.cycleCountCreate,
            send: assignmentOperations.cycleCountSend,
            scope: BinPicker,
          },
        ]}
        assignees={(assignees.data as { items: AssigneeOption[] } | undefined)?.items ?? []}
        aside={(assignment) => (
          <Link className="text-sm underline" to={`${board}/${assignment.id}`}>
            Reports
          </Link>
        )}
      />
    </div>
  );
}

/** The tags of one report, found and missing. */
function CountBody({ report }: { report: AssignmentReport }) {
  const { found, missing } = report.body as unknown as Count;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Found</dt>
      <dd className="font-mono">{found.join(', ') || 'None'}</dd>
      <dt className="text-muted-foreground">Missing</dt>
      <dd className="font-mono">{missing.join(', ') || 'None'}</dd>
    </dl>
  );
}

/** One cycle count and its reports, each discarded or accepted. */
function CountScreen() {
  const { assignmentId } = useParams({ strict: false }) as { assignmentId: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Cycle count" get={assignmentOperations.get} param="assignmentId" />
      <AssignmentReports
        list={assignmentOperations.reportList}
        discard={assignmentOperations.reportDiscard}
        kinds={[
          {
            kind: cycleCount,
            accept: assignmentOperations.cycleCountAccept,
            body: (report) => <CountBody report={report} />,
          },
        ]}
        input={{ assignmentId }}
      />
    </div>
  );
}

function BriefLine({ item }: { item: FeedItem }) {
  const brief = item.brief as unknown as Brief;
  return (
    <p className="text-sm">
      Count bin <span className="font-mono font-medium">{brief.bin}</span>: {brief.tools.length}{' '}
      {brief.tools.length === 1 ? 'tool' : 'tools'}.
    </p>
  );
}

type Mark = 'found' | 'missing';

/**
 * Each tool of the brief with its status when the count was sent, marked found or missing. A
 * tool left unmarked is not in the report and keeps its status.
 */
function CountForm({ item, submit }: { item: FeedItem; submit: SubmitReport }) {
  const brief = item.brief as unknown as Brief;
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const marked = (mark: Mark) =>
    brief.tools.map((tool) => tool.assetTag).filter((tag) => marks[tag] === mark);
  return (
    <form
      aria-label={`Report on ${item.title}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ found: marked('found'), missing: marked('missing') }).then(
          (done) => done && setMarks({}),
        );
      }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset tag</TableHead>
            <TableHead>Status when sent</TableHead>
            <TableHead>In the bin</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brief.tools.map((tool) => (
            <TableRow key={tool.assetTag}>
              <TableCell className="font-mono">{tool.assetTag}</TableCell>
              <TableCell>{words(tool.status)}</TableCell>
              <TableCell>
                <NativeSelect
                  aria-label={`${tool.assetTag} in the bin`}
                  value={marks[tool.assetTag] ?? ''}
                  onChange={(event) =>
                    setMarks({ ...marks, [tool.assetTag]: event.target.value as Mark })
                  }
                >
                  <option value="">Not counted</option>
                  <option value="found">Found</option>
                  <option value="missing">Missing</option>
                </NativeSelect>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button type="submit" variant="secondary">
        Report
      </Button>
    </form>
  );
}

/** The cycle counts sent to the signed-in attendant, with the count form and Done. */
function Mine() {
  return (
    <MyAssignments
      title="My cycle counts"
      feed={assignmentOperations.feed}
      complete={assignmentOperations.complete}
      kinds={[
        {
          kind: cycleCount,
          report: assignmentOperations.cycleCountReport,
          brief: (item) => <BriefLine item={item} />,
          form: (item, submit) => <CountForm item={item} submit={submit} />,
        },
      ]}
    />
  );
}

/** The cycle counts board, one count with its reports, one report, and my cycle counts. */
export const cycleCountRoutes = [
  { path: 'assignments/cycle-counts', component: Board },
  { path: 'assignments/cycle-counts/$assignmentId', component: CountScreen },
  {
    path: 'assignments/cycle-counts/reports/$reportId',
    component: () => (
      <RecordScreen title="Report" get={assignmentOperations.reportGet} param="reportId" />
    ),
  },
  { path: 'assignments/my-cycle-counts', component: Mine },
];
