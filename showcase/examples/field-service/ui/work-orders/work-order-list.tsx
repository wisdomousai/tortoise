import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { operations } from '../../contracts';
import { SidebarLink, SidebarSection } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';
import { message, PAGE, useWorkOrderId, type WorkOrder } from './shared';

type Draft = { name: string; site: string };
const emptyDraft: Draft = { name: '', site: '' };

/** The sidebar form for a new work order. The parent keeps the draft across collapsing it. */
function NewWorkOrderForm({
  draft,
  onDraft,
  error,
  onSubmit,
}: {
  draft: Draft;
  onDraft: (draft: Draft) => void;
  error: string;
  onSubmit: () => void;
}) {
  const field =
    'h-9 border-white/15 bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted';
  return (
    <form
      className="mt-1 space-y-1.5 px-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="Work order name"
        placeholder="Work order name"
        required
        autoFocus
        value={draft.name}
        onChange={(event) => onDraft({ ...draft, name: event.target.value })}
        className={field}
      />
      <Input
        aria-label="Site address"
        placeholder="Site address (optional)"
        value={draft.site}
        onChange={(event) => onDraft({ ...draft, site: event.target.value })}
        className={field}
      />
      <Button type="submit" size="sm" className="w-full">
        Create work order
      </Button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </form>
  );
}

/**
 * Sidebar section: the person's work orders with the open one highlighted, and creating one. The
 * list is server-paginated; closed work orders are counted and listed separately.
 */
export function WorkOrderList() {
  const navigate = useNavigate();
  const current = useWorkOrderId();
  const active = useQuery(
    live.liveQueryOptions(operations.workOrderList, { closed: false, limit: PAGE }),
  );
  const closed = useQuery(
    live.liveQueryOptions(operations.workOrderList, { closed: true, limit: PAGE }),
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');
  const create = async () => {
    setError('');
    try {
      const site = draft.site.trim();
      const receipt = await client.command(operations.workOrderCreate, {
        name: draft.name,
        ...(site ? { site } : {}),
      });
      setDraft(emptyDraft);
      setCreating(false);
      void navigate({
        to: '/work-orders/$workOrderId',
        params: { workOrderId: receipt.result.id },
      });
    } catch (cause) {
      setError(message(cause));
    }
  };
  const link = (workOrder: WorkOrder) => (
    <SidebarLink
      key={workOrder.id}
      to="/work-orders/$workOrderId"
      params={{ workOrderId: workOrder.id }}
      active={workOrder.id === current}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1 truncate">{workOrder.name}</span>
    </SidebarLink>
  );
  return (
    <SidebarSection
      title="Work orders"
      action={
        <button
          type="button"
          aria-label="Add a work order"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
          className="rounded p-0.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      }
    >
      {active.data?.items.map(link)}
      {active.data && active.data.count > active.data.items.length && (
        <p className="px-3 py-1 text-xs text-sidebar-muted">
          {active.data.count - active.data.items.length} more; find them with ⌘K
        </p>
      )}
      {creating && (
        <NewWorkOrderForm
          draft={draft}
          onDraft={setDraft}
          error={error}
          onSubmit={() => void create()}
        />
      )}
      {closed.data && closed.data.count > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer px-3 py-1.5 text-sm text-sidebar-muted hover:text-sidebar-foreground">
            Closed ({closed.data.count})
          </summary>
          {closed.data.items.map(link)}
        </details>
      )}
    </SidebarSection>
  );
}
