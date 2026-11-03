import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { reconciliationOperations } from '@agent-native/contracts';
import { useOperatorSession } from '@agent-native/workstation-sign-in/plugin-screens';
import type { AgentSelection } from '@/components/accounts';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { ScanPrompt } from '@/components/scan-prompt';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUiSession, type UiReview } from '@/lib/ui-session';
import { operations } from '../contracts';
import { eamTarget } from '../contracts/eam-target';
import { loanConditions, loans, type Loan, type RepairOrder } from '../contracts/loan';
import { toolCategories, type Tool } from '../contracts/tool';
import { takeBadge, terminalPath, useBadgeScans, useCounterScans } from './counter-scanner';
import { OperatorForm } from './operator-form';
import { OverdueList } from './overdue';
import { RunReview, TerminalAgent } from './terminal-agent';
import { toolResource, type SelectedTool } from './terminal-runs';
import { TerminalTools } from './terminal-tools';

/*
 * The work of the counter terminal. The sign-in plugin shows it at /terminal once an attendant has
 * signed in with badge and PIN, and leaving that route ends the session, so the counter, the
 * overdue list and the tool list are tabs here. Every query and command goes through the
 * attendant's client from `useOperatorSession`, so the instance authorizes the attendant's own
 * role and records them as `checkedOutBy` and `returnedBy`. Only the UI session and the agent
 * panel call the host as the terminal's own session, so an agent run acts as the terminal.
 */

const PAST = 10;
const when = (at?: number) => (at === undefined ? '' : new Date(at).toLocaleString());
/** A repair order in one cell: its number, the EAM's refusal code, or that it waits. */
const orderCell = (order?: RepairOrder) =>
  !order
    ? ''
    : order.sync === 'accepted'
      ? (order.sorRef ?? 'Opened')
      : order.sync === 'rejected'
        ? (order.rejection?.code ?? 'Refused')
        : 'Waiting';

const pastColumns: LiveColumn<Loan>[] = [
  { id: 'borrower', header: 'Borrower', cell: ({ row }) => row.original.borrower },
  { id: 'workOrder', header: 'Work order', cell: ({ row }) => row.original.workOrder },
  { id: 'checkedOut', header: 'Checked out', cell: ({ row }) => when(row.original.checkedOutAt) },
  { id: 'checkedOutBy', header: 'Lent by', cell: ({ row }) => row.original.checkedOutBy },
  { id: 'returned', header: 'Returned', cell: ({ row }) => when(row.original.returnedAt) },
  { id: 'returnedBy', header: 'Taken back by', cell: ({ row }) => row.original.returnedBy ?? '' },
  { id: 'condition', header: 'Condition', cell: ({ row }) => row.original.condition ?? '' },
  { id: 'note', header: 'Note', cell: ({ row }) => row.original.note ?? '' },
  {
    id: 'repairOrder',
    header: 'Repair order',
    cell: ({ row }) => orderCell(row.original.repairOrder),
  },
];

/**
 * The repair order the tool's last damaged return sent to the EAM: its number once the EAM opened
 * it, or what needs attention. After a refusal such as ASSET_UNKNOWN, a person opens the order in
 * the EAM by hand. A delivery whose answer was lost is held, and a person decides it on the EAM
 * screen.
 */
function RepairOrderStatus({ loanId, order }: { loanId: string; order: RepairOrder }) {
  const { live } = useOperatorSession();
  const held = useQuery({
    ...live.liveQueryOptions(reconciliationOperations.reconciliationList, {
      target: eamTarget.target,
      resource: loans.resource(loanId),
    }),
    enabled: order.sync === 'pending',
  });
  const isHeld = order.sync === 'pending' && (held.data?.items.length ?? 0) > 0;
  return (
    <section aria-label="Repair order" className="space-y-2">
      <h3 className="text-base font-medium">Repair order</h3>
      {order.sync === 'accepted' && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Number</dt>
          <dd className="font-mono">{order.sorRef}</dd>
        </dl>
      )}
      {order.sync === 'rejected' && (
        <p role="alert" className="text-sm text-destructive">
          Needs attention: the EAM refused the repair order ({order.rejection?.code}:{' '}
          {order.rejection?.message}). Fix the cause in the EAM and open the repair order there.
        </p>
      )}
      {isHeld && (
        <p role="alert" className="text-sm text-destructive">
          Needs attention: the EAM's answer was lost. Check the EAM and decide the repair order on
          the EAM screen.
        </p>
      )}
      {order.sync === 'pending' && !isHeld && (
        <p className="text-sm text-muted-foreground">Sent to the EAM, waiting for its answer.</p>
      )}
    </section>
  );
}

/** The tool's open loan: who has it, for which work order, when it is due and who lent it. */
function OpenLoan({ loan }: { loan: Loan }) {
  return (
    <section aria-label="Open loan" className="space-y-3">
      <h3 className="text-base font-medium">Open loan</h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Borrower</dt>
        <dd>{loan.borrower}</dd>
        <dt className="text-muted-foreground">Work order</dt>
        <dd>{loan.workOrder}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd>{loan.dueAt}</dd>
        <dt className="text-muted-foreground">Checked out</dt>
        <dd>{when(loan.checkedOutAt)}</dd>
        <dt className="text-muted-foreground">Lent by</dt>
        <dd>{loan.checkedOutBy}</dd>
      </dl>
    </section>
  );
}

/**
 * The tool's loans, newest first. A tool has at most one open loan and it is the newest, so the
 * newest loan is the open one when it has no return time, and the past loans start after it. The
 * instance pages and counts the list, so the table never pages over a partial set.
 */
function ToolLoans({ toolId }: { toolId: string }) {
  const { live } = useOperatorSession();
  const [offset, setOffset] = useState(0);
  const newest = useQuery(
    live.liveQueryOptions(operations.loanList, { toolId, limit: 1 } as never),
  );
  const first = (newest.data as { items: Loan[] } | undefined)?.items[0];
  const open = first && first.returnedAt === undefined ? first : undefined;
  // A tool in repair has the damaged return as its newest loan.
  const repair = first?.repairOrder;
  const skip = open ? 1 : 0;
  const past = useQuery({
    ...live.liveQueryOptions(operations.loanList, {
      toolId,
      offset: offset + skip,
      limit: PAST,
    } as never),
    enabled: newest.isSuccess,
  });
  const data = past.data as { items: Loan[]; total: number } | undefined;
  return (
    <>
      {open && <OpenLoan loan={open} />}
      {first && repair && <RepairOrderStatus loanId={first.id} order={repair} />}
      <section aria-label="Past loans" className="space-y-3">
        <h3 className="text-base font-medium">Past loans</h3>
        <LiveDataTable
          columns={pastColumns}
          rows={data?.items ?? []}
          count={Math.max(0, (data?.total ?? 0) - skip)}
          offset={offset}
          limit={PAST}
          onOffset={setOffset}
          empty="No past loans."
        />
      </section>
    </>
  );
}

/**
 * The check-out form. A badge scan fills the borrower and keeps the other fields; the attendant
 * completes the form and checks out.
 */
function CheckOut({ toolId }: { toolId: string }) {
  const { client } = useOperatorSession();
  const [badge, setBadge] = useState<{ key: number; values: { borrower: string } }>();
  useBadgeScans((borrower) =>
    setBadge((current) => ({ key: (current?.key ?? 0) + 1, values: { borrower } })),
  );
  return (
    <section aria-label={operations.toolCheckOut.description} className="space-y-3">
      <h3 className="text-base font-medium">Check out</h3>
      <p className="text-sm text-muted-foreground">
        Scan the borrower's badge or type the employee number.
      </p>
      <OperatorForm
        transport={client.transport}
        capability={operations.toolCheckOut}
        fixed={{ toolId }}
        fields={[
          { name: 'borrower', label: 'Borrower' },
          { name: 'workOrder', label: 'Work order' },
          { name: 'dueAt', label: 'Due' },
        ]}
        fill={badge}
        submitLabel="Check out"
      />
    </section>
  );
}

/**
 * One tool at the counter: what it is and where it stands, then the form that fits its status. An
 * available tool can be checked out and a lent tool can be returned; any other status offers
 * neither, and the instance refuses the command if the status changed meanwhile. A `review` an
 * agent run asked for about `tool.update` shows above the edit form, with the bin field focused:
 * the attendant enters the change and saves it as themselves, and the run never writes.
 */
function ToolCounter({
  id,
  review,
  onAcknowledge,
}: {
  id: string;
  review?: UiReview;
  onAcknowledge: () => Promise<void>;
}) {
  const { client, live } = useOperatorSession();
  const query = useQuery(live.liveQueryOptions(operations.toolGet, { id }));
  const tool = query.data as Tool | undefined;
  if (query.isError) return <p className="text-muted-foreground">Tool unavailable.</p>;
  const fields: [string, string | undefined][] = [
    ['Asset tag', tool?.assetTag],
    ['Description', tool?.description],
    ['Bin', tool?.bin],
    ['Status', tool?.status],
    ['Calibration due', tool?.calibrationDue ?? 'Not required'],
  ];
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Tool {tool?.assetTag ?? id}</h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {tool?.status === 'available' && <CheckOut toolId={id} />}
      {tool?.status === 'checked-out' && (
        <section aria-label={operations.toolReturn.description} className="space-y-3">
          <h3 className="text-base font-medium">Return</h3>
          <OperatorForm
            transport={client.transport}
            capability={operations.toolReturn}
            fixed={{ toolId: id }}
            fields={[
              { name: 'condition', label: 'Condition', choices: loanConditions },
              { name: 'note', label: 'Note', optional: true },
            ]}
            submitLabel="Return"
          />
        </section>
      )}
      <ToolLoans toolId={id} />
      {tool && (
        <section aria-label={operations.toolUpdate.description} className="space-y-3">
          <h3 className="text-base font-medium">Edit</h3>
          {review && (
            <RunReview
              review={review}
              hint="Enter the bin below and save it; the run changes nothing."
              onAcknowledge={onAcknowledge}
            />
          )}
          <OperatorForm
            transport={client.transport}
            capability={operations.toolUpdate}
            fixed={{ id }}
            fields={[
              { name: 'description', label: 'Description', optional: true },
              { name: 'category', label: 'Category', choices: toolCategories, optional: true },
              { name: 'bin', label: 'Bin', optional: true },
              { name: 'calibrationDue', label: 'Calibration due', optional: true },
            ]}
            submitLabel="Save"
            {...(review ? { focus: { key: review.id, name: 'bin' } } : {})}
          />
        </section>
      )}
    </div>
  );
}

/** The tool a review asks the attendant to change: the one it names, else the open one. */
function reviewedTool(review: UiReview | undefined, open: string | undefined) {
  if (!review?.operations.includes(operations.toolUpdate.id)) return undefined;
  const named = review.resources.find((resource) => resource.startsWith('tool:'));
  return named ? named.slice('tool:'.length) : open;
}

/**
 * The ticked tools as the Tools tab hands them over: ticking adds a tool after the others, and a
 * page read refreshes the revision of each ticked tool on it.
 */
function useToolSelection() {
  const [selected, setSelected] = useState<readonly SelectedTool[]>([]);
  const toggle = (tool: Tool, on: boolean) =>
    setSelected((current) =>
      on
        ? [
            ...current.filter((entry) => entry.id !== tool.id),
            { id: tool.id, assetTag: tool.assetTag, revision: tool.revision ?? 0 },
          ]
        : current.filter((entry) => entry.id !== tool.id),
    );
  const refresh = (rows: readonly Tool[]) =>
    setSelected((current) => {
      const next = current.map((entry) => {
        const row = rows.find((tool) => tool.id === entry.id);
        return row && (row.revision ?? 0) !== entry.revision
          ? { ...entry, revision: row.revision ?? 0 }
          : entry;
      });
      return next.some((entry, index) => entry !== current[index]) ? next : current;
    });
  return { selected, toggle, refresh };
}

/**
 * The counter terminal's work: the Counter tab, where a scanned or typed asset tag opens a tool,
 * the Overdue tab, whose rows open their tool on the Counter tab, and the Tools tab, where the
 * attendant ticks tools and starts agent runs on them. A tool another screen opened at the
 * terminal arrives once in the `tool` search parameter, which is then cleared, so the next
 * attendant starts at the scan prompt.
 *
 * The work area owns one UI session, the terminal's, whose context is the ticked tools as
 * tool:<id> with the revision each row shows. A run started from the agent panel captures it, and
 * its intents come back here: an open shows the tool on the Counter tab instead of navigating,
 * since leaving the terminal ends the attendant's session, and a review that names `tool.update`
 * opens the tool it names and shows above its edit form. Any other review shows above the tabs.
 */
export function CounterTerminal() {
  const { client, live } = useOperatorSession();
  const navigate = useNavigate();
  const { tool: requested } = useSearch({ strict: false }) as { tool?: unknown };
  const [tab, setTab] = useState('counter');
  const [toolId, setToolId] = useState<string>();
  const [agent, setAgent] = useState<AgentSelection>({ harnessId: 'deterministic' });
  const [brief, setBrief] = useState('');
  const selection = useToolSelection();
  const open = (id: string) => {
    setToolId(id);
    setTab('counter');
  };
  // #region session
  const session = useUiSession(
    selection.selected.map((tool) => ({ id: toolResource(tool), revision: tool.revision })),
    {
      open: async (resource) => {
        if (!resource.startsWith('tool:')) throw new Error(`The counter cannot open ${resource}`);
        open(resource.slice('tool:'.length));
      },
      prepare: async () => {
        throw new Error('The counter forms take no prepared input');
      },
    },
  );
  // #endregion session
  const review = session.review;
  const reviewing = reviewedTool(review, toolId);
  // A review of a tool's change opens that tool once, wherever the attendant is.
  useEffect(() => {
    if (reviewing) open(reviewing);
  }, [review?.id]);
  const acknowledge = () => session.acknowledgeReview(true);
  useEffect(() => {
    if (requested === undefined) return;
    if (typeof requested === 'string') open(requested);
    void navigate({ to: terminalPath, search: {}, replace: true } as never);
  }, [requested, navigate]);
  const scans = useCounterScans({
    reader: client,
    bindings: live,
    enabled: true,
    onTool: (tool) => open(tool.id),
    onBadge: takeBadge,
  });

  return (
    <div className="space-y-6">
      {review && !reviewing && (
        <RunReview
          review={review}
          hint="Look at the records it names, then acknowledge it."
          onAcknowledge={acknowledge}
        />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="counter">Counter</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>
        <TabsContent value="counter" className="space-y-6">
          <ScanPrompt
            prompt="Scan a tool"
            hint="A tool tag opens the tool. A badge fills the borrower when you lend a tool."
            last={scans.last}
            onManual={(assetTag) => void scans.openTool(assetTag)}
            manualLabel="Type the asset tag"
          />
          {scans.error && <p className="text-sm text-destructive">{scans.error}</p>}
          {toolId && (
            <ToolCounter
              key={toolId}
              id={toolId}
              {...(review && reviewing === toolId ? { review } : {})}
              onAcknowledge={acknowledge}
            />
          )}
        </TabsContent>
        <TabsContent value="overdue">
          <OverdueList onOpen={(loan) => open(loan.toolId)} />
        </TabsContent>
        <TabsContent value="tools" className="space-y-6">
          <TerminalTools
            selected={selection.selected}
            onToggle={selection.toggle}
            onRows={selection.refresh}
            onOpen={(tool) => open(tool.id)}
          />
          <TerminalAgent
            selected={selection.selected}
            agent={agent}
            onAgent={setAgent}
            brief={brief}
            onBrief={setBrief}
            prepareSession={session.prepare}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
