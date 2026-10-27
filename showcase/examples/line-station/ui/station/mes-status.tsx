import { useQuery } from '@tanstack/react-query';
import { live } from '@/lib/session';
import { operations } from '../../contracts';

/** Sidebar status: what the MES and the station screens still have to accept. */
export function MesStatus() {
  const sync = useQuery(live.liveQueryOptions(operations.syncStatus, {}));
  if (!sync.data) return null;
  const totals = sync.data.targets.reduce(
    (sum, target) => ({
      open: sum.open + target.pending + target.retrying,
      held: sum.held + target.held,
      rejected: sum.rejected + target.rejected,
    }),
    { open: 0, held: 0, rejected: 0 },
  );
  return (
    <div className="space-y-1">
      <p className="font-medium text-sidebar-foreground">
        {totals.rejected
          ? `${totals.rejected} rejected`
          : totals.held
            ? `${totals.held} to reconcile`
            : totals.open
              ? `${totals.open} sending`
              : 'MES: all sent'}
      </p>
      {sync.data.lastSyncAt !== undefined && (
        <p>
          Orders synced{' '}
          {new Date(sync.data.lastSyncAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
    </div>
  );
}
