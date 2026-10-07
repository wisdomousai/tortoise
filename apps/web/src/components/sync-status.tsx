import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, Clock3 } from 'lucide-react';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { DeliveryBadge } from '@/components/status-strip';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';

export const syncStatusQuery = () => live.liveQueryOptions(operations.syncStatus, {});

/**
 * Outbox state at a glance. A commit receipt proves the local write only; this badge is where
 * operators see whether the system of record has accepted it yet.
 */
export function SyncBadge({ className }: { className?: string }) {
  const status = useQuery(syncStatusQuery());
  if (!status.data) return null;
  const { pending, rejected, retrying } = status.data;
  const tone = rejected ? 'text-destructive' : pending ? 'text-warning' : 'text-success';
  const Icon = rejected ? CircleAlert : pending ? Clock3 : CircleCheck;
  return (
    <Link
      to="/sync"
      className={cn('flex items-center gap-2 rounded-md text-xs hover:underline', className)}
      aria-label={`Quality system sync: ${pending} pending, ${rejected} rejected`}
    >
      <Icon className={cn('size-4', tone)} aria-hidden />
      <span>
        {rejected
          ? `${rejected} rejected by quality system`
          : pending
            ? `${pending} awaiting quality system${retrying ? ' · retrying' : ''}`
            : 'Quality system in sync'}
      </span>
    </Link>
  );
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
