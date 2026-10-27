import { useState } from 'react';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { client } from '@/lib/session';
import { message, type WorkOrder } from './shared';

/** Who may see and change the work order. Membership applies to the UI, tools and delegated runs. */
export function WorkOrderAccess({
  workOrder,
  onError,
}: {
  workOrder: WorkOrder;
  onError: (message: string) => void;
}) {
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'technician' | 'customer' | 'dispatcher' | 'remove'>('customer');
  if (!workOrder.members) return null;
  return (
    <section
      aria-label="Work order access"
      className="mx-6 mb-4 space-y-3 rounded-xl border bg-muted/40 p-4 text-sm"
    >
      <p className="text-muted-foreground">
        Access applies everywhere: this screen, tools and agents acting for someone.
      </p>
      <ul className="space-y-1.5">
        {Object.entries(workOrder.members).map(([principal, membership]) => (
          <li key={principal} className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase"
            >
              {principal[0]}
            </span>
            <span className="flex-1 font-medium">{principal}</span>
            <span className="text-muted-foreground capitalize">{membership}</span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(
              operations.workOrderSetMember,
              { id: workOrder.id, principalId, role: role === 'remove' ? null : role },
              { expectedRevisions: { [`work-order:${workOrder.id}`]: workOrder.revision } },
            )
            .then(() => setPrincipalId(''))
            .catch((error) => onError(message(error)));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="member">Person</Label>
          <Input
            id="member"
            placeholder="User ID"
            value={principalId}
            onChange={(event) => setPrincipalId(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="member-role">Role</Label>
          <NativeSelect
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="customer">Customer</option>
            <option value="technician">Technician</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="remove">Remove access</option>
          </NativeSelect>
        </div>
        <Button type="submit">Update access</Button>
      </form>
    </section>
  );
}
