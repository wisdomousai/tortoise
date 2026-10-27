import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';

export type LocalStatus = 'none' | 'following' | 'adopted' | 'rejected';

/** Followed accounts by CRM ID, live: newer than the `local` field of a search result. */
export function useLocalAccounts() {
  const accounts = useQuery(live.liveQueryOptions(operations.accountList, {}));
  const byId = new Map((accounts.data?.items ?? []).map((account) => [account.id, account]));
  return { accounts: accounts.data?.items ?? [], byId };
}

const labels: Record<Exclude<LocalStatus, 'none'>, string> = {
  following: 'Adopting…',
  adopted: 'Adopted',
  rejected: 'Refused by CRM',
};

/** Where an account stands in this workspace. */
export function LocalStatusBadge({ status }: { status: Exclude<LocalStatus, 'none'> }) {
  return (
    <Badge
      variant={
        status === 'rejected' ? 'destructive' : status === 'adopted' ? 'secondary' : 'outline'
      }
    >
      {labels[status]}
    </Badge>
  );
}
