import { useQuery } from '@tanstack/react-query';
import { activityOperations } from '../contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { live } from '@/lib/session';

/** Command counts per operation (`activity.summary.get`), following the live query. */
export function ActivityScreen() {
  const summary = useQuery(live.liveQueryOptions(activityOperations.summaryGet, {}));
  if (summary.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {summary.error instanceof Error ? summary.error.message : 'Activity unavailable'}
      </p>
    );
  if (!summary.data) return <p role="status">Reading activity…</p>;
  const data = summary.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Committed commands per operation, counted from the journal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {data.modules.map((module) => (
            <Badge key={module} variant="outline">
              {module}
            </Badge>
          ))}
        </div>
        {data.operations.length ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {data.operations.map(({ operation, count }) => (
              <div key={operation} className="contents">
                <dt className="font-mono text-muted-foreground">{operation}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">No commands counted yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
