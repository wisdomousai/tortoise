import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { live } from '@/lib/session';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { operations } from '../contracts';

const kinds: Record<string, string> = {
  stale: 'Not reporting',
  held: 'Held effects',
  'audit-broken': 'Audit chain broken',
  'audit-behind': 'Audit behind',
  'release-drift': 'Release drift',
  'past-best-before': 'Past best-before date',
};

/** Every instance that needs a look, and why. */
export function HealthScreen() {
  const health = useQuery(live.liveQueryOptions(operations.fleetHealth, {}));
  const issues = health.data?.issues ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Health</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {health.data?.instances ?? 0} instances,{' '}
          {new Set(issues.map((issue) => issue.instance)).size} with issues
        </p>
      </header>
      {issues.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instance</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((issue) => (
              <TableRow key={`${issue.instance}:${issue.kind}`}>
                <TableCell>
                  <Link to="/instances/$id" params={{ id: issue.instance }} className="underline">
                    {issue.instance}
                  </Link>
                </TableCell>
                <TableCell>{kinds[issue.kind] ?? issue.kind}</TableCell>
                <TableCell className="text-muted-foreground">{issue.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No instance needs a look.</p>
      )}
    </div>
  );
}
