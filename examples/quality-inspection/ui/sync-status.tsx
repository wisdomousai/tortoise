import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { operations } from '../contracts';
import { NavigationCount } from '@/components/app-shell';
import { DeliveryBadge } from '@/components/status-strip';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';

export const syncStatusQuery = () => live.liveQueryOptions(operations.syncStatus, {});

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Outbox state at a glance, in the sidebar footer. A commit receipt proves the local write only;
 * this is where people see whether the quality system has accepted it yet.
 */
export function SyncBadge({ className }: { className?: string }) {
  const status = useQuery(syncStatusQuery());
  if (!status.data) return null;
  const { pending, rejected, retrying, lastSyncAt } = status.data;
  const tone = rejected ? 'text-red-400' : pending ? 'text-amber-400' : 'text-emerald-400';
  const Icon = rejected ? CircleAlert : pending ? RefreshCw : CircleCheck;
  return (
    <div className={cn('space-y-1', className)}>
      <Link
        to="/attention"
        className="flex items-center gap-2 font-medium text-sidebar-foreground hover:underline"
        aria-label={`Quality system sync: ${pending} pending, ${rejected} rejected`}
      >
        <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
        <span>
          {rejected
            ? `${rejected} rejected by quality system`
            : pending
              ? `Quality system: ${pending} sending${retrying ? ' · retrying' : ''}`
              : 'Quality system in sync'}
        </span>
      </Link>
      {lastSyncAt !== undefined && <p>Master data synced {clock(lastSyncAt)}</p>}
    </div>
  );
}

/** Navigation badge: open rejections waiting on a person. */
export function RejectionCount() {
  const status = useQuery(syncStatusQuery());
  return <NavigationCount count={status.data?.rejected} tone="attention" label="rejected" />;
}

/** Sidebar context: where and as whom the person inspects. */
export function PlantContext() {
  const plants = useQuery(live.liveQueryOptions(operations.plantList, {}));
  const items = plants.data?.items ?? [];
  if (!items.length) return null;
  if (items.length === 1)
    return (
      <>
        Plant {items[0]!.plant} · {items[0]!.role}
      </>
    );
  return <>{items.length} plants</>;
}

/** Per-record sync marker used in result lists and the capture station history. */
export function SyncMarker({
  sync,
  sorRef,
  rejection,
}: {
  sync: 'pending' | 'accepted' | 'rejected';
  sorRef?: string;
  rejection?: { code: string; message: string };
}) {
  return <DeliveryBadge state={sync} reference={sorRef} reason={rejection} />;
}
