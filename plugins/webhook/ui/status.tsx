import { useQuery } from '@tanstack/react-query';
import { webhookOperations } from '../contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { live } from '@/lib/session';

const time = (at: number | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString());

/** Delivery status (`webhook.status.get`): what is observed, delivered and the last error. */
export function WebhookScreen() {
  const status = useQuery({
    ...live.liveQueryOptions(webhookOperations.statusGet, {}),
    refetchInterval: 5_000,
  });
  if (status.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {status.error instanceof Error ? status.error.message : 'Webhook status unavailable'}
      </p>
    );
  if (!status.data) return <p role="status">Reading webhook status…</p>;
  const data = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook</CardTitle>
        <CardDescription>
          Change notifications posted to the webhook destination. Only resource ids and revisions
          leave the machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {data.observing.length ? (
            data.observing.map((operation) => (
              <Badge key={operation} variant="outline">
                {operation}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">Inactive: no operations configured.</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Delivered</dt>
          <dd>{data.delivered}</dd>
          <dt className="text-muted-foreground">Failures</dt>
          <dd>{data.failures}</dd>
          <dt className="text-muted-foreground">Last delivery</dt>
          <dd>{time(data.lastDeliveredAt)}</dd>
        </dl>
        {data.lastError ? (
          <p role="alert" className="text-destructive">
            {data.lastError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
