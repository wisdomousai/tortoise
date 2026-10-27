import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';

export type LocalStatus = 'none' | 'requested' | 'following' | 'rejected';

/** Followed accounts by CRM ID, live: newer than the `local` field of a search result. */
export function useLocalAccounts() {
  const accounts = useQuery(live.liveQueryOptions(operations.accountList, {}));
  const byId = new Map((accounts.data?.items ?? []).map((account) => [account.id, account]));
  return { accounts: accounts.data?.items ?? [], byId };
}

const labels: Record<Exclude<LocalStatus, 'none'>, string> = {
  requested: 'Follow requested',
  following: 'Following',
  rejected: 'Refused by CRM',
};

/** Where an account stands in this workspace. */
export function LocalStatusBadge({ status }: { status: Exclude<LocalStatus, 'none'> }) {
  return (
    <Badge
      variant={
        status === 'rejected' ? 'destructive' : status === 'following' ? 'secondary' : 'outline'
      }
    >
      {labels[status]}
    </Badge>
  );
}
