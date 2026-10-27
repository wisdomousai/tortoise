import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';

/** CRM synchronization at a glance, in the sidebar footer. */
export function SyncBadge({ className }: { className?: string }) {
  const status = useQuery(live.liveQueryOptions(operations.syncStatus, {}));
  if (!status.data) return null;
  const { pending, rejected, requested } = status.data;
  const tone = rejected
    ? 'text-red-400'
    : pending || requested
      ? 'text-amber-400'
      : 'text-emerald-400';
  const Icon = rejected ? CircleAlert : pending || requested ? RefreshCw : CircleCheck;
  return (
    <p className={cn('flex items-center gap-2 font-medium text-sidebar-foreground', className)}>
      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
      {pending || requested
        ? `CRM: ${pending + requested} waiting`
        : rejected
          ? `CRM refused ${rejected}`
          : 'CRM in sync'}
    </p>
  );
}
