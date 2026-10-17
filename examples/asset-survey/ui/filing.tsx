import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { Empty, Page, when } from './shared';

/** Every filing with the EAM's answer: the asset it created or updated, or why it refused. */
export function FilingScreen() {
  const filings = useQuery(live.liveQueryOptions(operations.filingList, {}));
  const status = useQuery(live.liveQueryOptions(operations.filingStatus, {}));
  return (
    <Page
      title="Filing"
      description={
        status.data
          ? `${status.data.pending} waiting · ${status.data.accepted} accepted · ${status.data.rejected} refused${
              status.data.lastSyncAt ? ` · EAM read ${when(status.data.lastSyncAt)}` : ''
            }`
          : undefined
      }
    >
      {filings.data?.items.length === 0 && (
        <Empty>
          Nothing filed yet. File a node from its page once its attributes are accepted.
        </Empty>
      )}
      <ul aria-label="Filings" className="divide-y rounded-xl border bg-card text-sm">
        {(filings.data?.items ?? []).map((filing) => (
          <li
            key={filing.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="min-w-0">
              <Link
                to="/structure/$nodeId"
                params={{ nodeId: filing.nodeId }}
                className="font-mono font-medium hover:underline"
              >
                {filing.designation}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {filing.assetId ? `update ${filing.assetId}` : 'new asset'} · {when(filing.filedAt)}{' '}
                by {filing.filedBy}
              </span>
              {filing.rejection && (
                <p className="text-destructive">
                  {filing.rejection.code}: {filing.rejection.message}
                </p>
              )}
            </div>
            <Badge
              variant={
                filing.sync === 'rejected'
                  ? 'destructive'
                  : filing.sync === 'accepted'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {filing.sync === 'accepted'
                ? filing.sorRef
                : filing.sync === 'rejected'
                  ? 'Refused'
                  : 'Waiting for the EAM'}
            </Badge>
          </li>
        ))}
      </ul>
    </Page>
  );
}
