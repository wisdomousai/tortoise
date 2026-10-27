import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { operations } from '../../contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';
import { runOsAction } from '@/lib/os-browser';
import { useUiSession } from '@/lib/ui-session';
import { AgentPanel } from './agent-panel';
import { PreparedTask } from './prepared-task';
import { WorkOrderAccess } from './work-order-access';
import { PAGE, message, useWorkOrderId, type WorkOrder } from './shared';
import { workOrderSummary } from './summary';
import { TaskGroup } from './task-group';

/** One action at a time for the screen: `busy` while it runs, its failure as `error`. */
function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return { error, setError, busy, action };
}

/**
 * Share the open work order with agent runs. A run that opens a work order or a task follows the
 * application's `resources` paths; the screen has no selection of its own to change.
 */
function useWorkOrderSession(workOrder: WorkOrder | undefined) {
  return useUiSession(
    workOrder ? { id: `work-order:${workOrder.id}`, revision: workOrder.revision } : undefined,
  );
}

/**
 * Run a declared OS action from a click; the shell or the browser performs it. A refusal, such as
 * a browser without the Web Share API, becomes the screen's error.
 */
async function osAction(action: string, params: Record<string, string>) {
  const outcome = await runOsAction(action, params);
  if (outcome.status === 'refused')
    throw new Error(`The system refused ${action} (${outcome.reason})`);
}

/** Map and summary for the work order's site. The open tasks are loaded before the click. */
function SiteActions({
  workOrder,
  busy,
  action,
}: {
  workOrder: WorkOrder;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const tasks = useQuery(
    live.liveQueryOptions(operations.taskList, { workOrderId: workOrder.id, limit: PAGE }),
  );
  return (
    <>
      {workOrder.site && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(() => osAction('work-order.site-map', { query: workOrder.site! }))
          }
        >
          Open map
        </Button>
      )}
      <Button
        variant="outline"
        disabled={busy || !tasks.data}
        onClick={() =>
          void action(() =>
            osAction('work-order.share', {
              title: workOrder.name,
              text: workOrderSummary(workOrder, tasks.data?.items ?? []),
            }),
          )
        }
      >
        Send summary
      </Button>
    </>
  );
}

/** Name, site, progress and access, with the access toggle, the site actions and close or reopen. */
function WorkOrderHeader({
  workOrder,
  done,
  count,
  sharing,
  onSharing,
  busy,
  action,
}: {
  workOrder: WorkOrder;
  done: number;
  count: number;
  sharing: boolean;
  onSharing: () => void;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const members = Object.keys(workOrder.members ?? {}).length;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          {workOrder.name}
        </h1>
        {workOrder.site && <p className="mt-1 text-sm">{workOrder.site}</p>}
        <p className="mt-1 text-sm text-muted-foreground">
          {done} of {count} done
          {members > 1
            ? ` · shared with ${members - 1} ${members === 2 ? 'person' : 'people'}`
            : ''}
          {workOrder.closed ? ' · closed' : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {workOrder.members && (
          <Button variant="outline" aria-expanded={sharing} onClick={onSharing}>
            Access
          </Button>
        )}
        <SiteActions workOrder={workOrder} busy={busy} action={action} />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(() =>
              client.command(
                workOrder.closed ? operations.workOrderReopen : operations.workOrderClose,
                { id: workOrder.id },
                { expectedRevisions: { [`work-order:${workOrder.id}`]: workOrder.revision } },
              ),
            )
          }
        >
          {workOrder.closed ? 'Reopen work order' : 'Close work order'}
        </Button>
      </div>
    </header>
  );
}

/** Add a task by title. The screen keeps the title, so closing and reopening keep it too. */
function NewTaskForm({
  title,
  onTitle,
  busy,
  onSubmit,
}: {
  title: string;
  onTitle: (title: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex gap-2 px-6 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="New task title"
        required
        placeholder="Add a task and press Enter"
        className="h-11"
        value={title}
        onChange={(event) => onTitle(event.target.value)}
      />
      <Button type="submit" variant="outline" className="h-11" disabled={busy}>
        Add task
      </Button>
    </form>
  );
}

/** One work order: its tasks grouped by status, its access and the agent working on it. */
export function WorkOrderScreen() {
  const workOrderId = useWorkOrderId()!;
  const workOrder = useQuery(live.liveQueryOptions(operations.workOrderGet, { id: workOrderId }));
  // Totals come from authorized counts, not from the rows on a visible page.
  const total = useQuery(live.liveQueryOptions(operations.taskList, { workOrderId, limit: 1 }));
  const done = useQuery(
    live.liveQueryOptions(operations.taskList, { workOrderId, status: 'done', limit: 1 }),
  );
  const { error, setError, busy, action } = useAction();
  const [taskName, setTaskName] = useState('');
  const [sharing, setSharing] = useState(false);
  const ui = useWorkOrderSession(workOrder.data);
  if (workOrder.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{workOrder.error.message}</AlertDescription>
      </Alert>
    );
  if (!workOrder.data) return <p role="status">Loading work order…</p>;
  const active = workOrder.data;
  const count = total.data?.count ?? 0;
  const addTask = () =>
    void action(async () => {
      await client.command(operations.taskCreate, { workOrderId: active.id, title: taskName });
      setTaskName('');
    });
  return (
    <div className="mx-auto grid max-w-7xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label="Tasks" className="overflow-hidden rounded-2xl border bg-card">
        <WorkOrderHeader
          workOrder={active}
          done={done.data?.count ?? 0}
          count={count}
          sharing={sharing}
          onSharing={() => setSharing((value) => !value)}
          busy={busy}
          action={action}
        />
        {sharing && <WorkOrderAccess workOrder={active} onError={setError} />}
        {error && (
          <Alert variant="destructive" role="alert" className="mx-6 mb-4 w-auto">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <PreparedTask workOrder={active} busy={busy} action={action} />
        {!active.closed && (
          <NewTaskForm title={taskName} onTitle={setTaskName} busy={busy} onSubmit={addTask} />
        )}
        {total.data && count === 0 && (
          <div className="mx-6 mb-6 rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-medium">A clear place to start</h2>
            <p className="text-sm text-muted-foreground">
              Add a task yourself, or turn a brief into tasks with the agent.
            </p>
          </div>
        )}
        <TaskGroup workOrder={active} status="doing" title="In progress" onError={setError} />
        <TaskGroup workOrder={active} status="todo" title="To do" onError={setError} />
        <TaskGroup workOrder={active} status="done" title="Done" onError={setError} collapsed />
      </section>
      <AgentPanel workOrder={active} ui={ui} busy={busy} action={action} onError={setError} />
    </div>
  );
}
