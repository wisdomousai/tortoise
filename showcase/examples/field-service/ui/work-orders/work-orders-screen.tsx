import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { client, live } from '@/lib/session';
import { message } from './shared';

/** `/work-orders`: opens the first work order, or offers to create one. */
export function WorkOrdersScreen() {
  const navigate = useNavigate();
  const workOrders = useQuery(
    live.liveQueryOptions(operations.workOrderList, { closed: false, limit: 1 }),
  );
  const first = workOrders.data?.items[0];
  useEffect(() => {
    if (first)
      void navigate({
        to: '/work-orders/$workOrderId',
        params: { workOrderId: first.id },
        replace: true,
      });
  }, [first, navigate]);
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [error, setError] = useState('');
  if (!workOrders.data || first) return <p role="status">Loading work orders…</p>;
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-dashed bg-card p-10 text-center">
      <h1 className="text-2xl font-semibold">Your first work order</h1>
      <p className="text-sm text-muted-foreground">
        Name it and give the customer site, then add tasks yourself or let the agent turn the
        instructions into tasks. Your data stays on this computer.
      </p>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(operations.workOrderCreate, {
              name,
              ...(site.trim() ? { site: site.trim() } : {}),
            })
            .then((commandResult) =>
              navigate({
                to: '/work-orders/$workOrderId',
                params: { workOrderId: commandResult.result.id },
              }),
            )
            .catch((cause) => setError(message(cause)));
        }}
      >
        <Label htmlFor="first-work-order" className="sr-only">
          New work order
        </Label>
        <Input
          id="first-work-order"
          placeholder="Work order name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Label htmlFor="first-work-order-site" className="sr-only">
          Site address
        </Label>
        <Input
          id="first-work-order-site"
          placeholder="Site address (optional)"
          value={site}
          onChange={(event) => setSite(event.target.value)}
        />
        <Button type="submit">Create work order</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
