import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { ActivityForm } from './account/activity-form';
import { LocalStatusBadge } from './local-status';

const when = (at: number) =>
  new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** One adopted account: what the CRM holds, and the activities logged here with their outcome. */
export function AccountScreen() {
  const { accountId } = useParams({ strict: false }) as { accountId: string };
  const account = useQuery(live.liveQueryOptions(operations.accountGet, { id: accountId }));
  if (account.error) return <p role="alert">{account.error.message}</p>;
  if (!account.data) return <p role="status">Loading account…</p>;
  const data = account.data;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">
            {data.name ?? `CRM account ${data.id}`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.status === 'adopted'
              ? `${data.industry} · ${data.city} · ${data.region} · owner ${data.owner} · CRM ${data.id}`
              : (data.rejection?.message ?? 'The CRM has not delivered this account yet.')}
          </p>
        </div>
        <LocalStatusBadge status={data.status} />
      </header>
      {data.status === 'adopted' && <ActivityForm accountId={data.id} />}
      <section aria-label="Activities" className="space-y-2">
        {data.history.map((activity) => (
          <article key={activity.id} className="rounded-xl border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium capitalize">
                {activity.kind} · {when(activity.occurredAt)}
              </span>
              <Badge
                variant={
                  activity.sync === 'rejected'
                    ? 'destructive'
                    : activity.sync === 'accepted'
                      ? 'secondary'
                      : 'outline'
                }
              >
                {activity.sync === 'accepted'
                  ? `In CRM ${activity.sorRef ?? ''}`
                  : activity.sync === 'rejected'
                    ? `Refused: ${activity.rejection?.message}`
                    : 'Sending to CRM'}
              </Badge>
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap">{activity.summary}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
