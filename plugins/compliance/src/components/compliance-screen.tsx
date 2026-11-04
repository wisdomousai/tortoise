import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@tortoise/contracts';
import { complianceOperations } from '@tortoise/compliance/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { live } from '@/lib/session';

type Posture = OutputOf<typeof complianceOperations.postureGet>;
type AuditEvent = OutputOf<typeof complianceOperations.eventsList>['items'][number];
const time = (at: number | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString());
// The audit log has no change feed of its own, so the screen polls: a denial shows up within
// seconds without a reload. Each read is itself audited.
const POLL_MS = 5_000;
const denialKinds = ['egress.denied', 'command.denied', 'query.denied'];

const statusTone = {
  ok: 'secondary',
  attention: 'outline',
  failing: 'destructive',
  pass: 'secondary',
  info: 'outline',
  warn: 'outline',
  fail: 'destructive',
} as const;

function PostureHeader({ data }: { data: Posture }) {
  return (
    <header className="space-y-1">
      <p className="text-xs font-medium tracking-widest text-muted-foreground">COMPLIANCE</p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Security posture</h1>
        <Badge variant={statusTone[data.status]} aria-label={`Posture ${data.status}`}>
          {data.status}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Profile <strong>{data.profile}</strong>, network <strong>{data.networkMode}</strong>, audit{' '}
        <strong>{data.auditMode}</strong>. Checked {time(data.checkedAt)}.
      </p>
    </header>
  );
}

function Checks({ checks }: { checks: Posture['checks'] }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Checks">
      {checks.map((check) => (
        <Card key={check.id} size="sm">
          <CardHeader>
            <CardDescription className="flex items-center justify-between gap-2">
              <span>{check.id}</span>
              <Badge variant={statusTone[check.status]}>{check.status}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">{check.summary}</CardContent>
        </Card>
      ))}
    </section>
  );
}

/** Chain head, forwarding and digests, plus a full re-verification on request. */
function AuditLog({ data }: { data: Posture }) {
  // A full re-verification of every segment on request, beyond the monitor's periodic check.
  const verification = useQuery({
    ...live.liveQueryOptions(complianceOperations.logVerify, {}),
    enabled: false,
  });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Head {data.log.headSeq}; {data.log.verified ? 'chain verified' : 'chain NOT verified'},{' '}
          {data.log.problems} problem(s), {data.log.checkpoints} checkpoint(s).
          {data.forwarding
            ? ` Forwarded ${data.forwarding.forwarded} to ${data.forwarding.destination}, ${data.forwarding.dropped} dropped.`
            : ' Not forwarded off this host.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 font-mono text-xs break-all text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2 pb-2 font-sans text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={verification.isFetching}
            onClick={() => void verification.refetch()}
          >
            Verify now
          </Button>
          {verification.data && (
            <span role="status">
              {verification.data.ok ? 'Chain intact' : 'Chain damaged'}: {verification.data.events}{' '}
              events in {verification.data.segments} segment(s), {verification.data.problems.length}{' '}
              problem(s).
            </span>
          )}
        </div>
        <p>policy {data.policyDigest}</p>
        {data.catalogDigest && <p>catalog {data.catalogDigest}</p>}
        {data.executableDigest && <p>executable {data.executableDigest}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Security posture for auditors (`compliance.*` bindings): what this installation may reach and
 * whether it did, recent denials, and whether the audit chain is intact. Read-only; changing
 * the posture means changing the deployment policy and restarting the instance.
 */
export function ComplianceScreen() {
  const posture = useQuery({
    ...live.liveQueryOptions(complianceOperations.postureGet, {}),
    refetchInterval: POLL_MS,
  });
  const denials = useQuery({
    ...live.liveQueryOptions(complianceOperations.eventsList, {
      kinds: denialKinds,
      limit: 25,
      newest: true,
    }),
    refetchInterval: POLL_MS,
  });
  if (posture.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {posture.error instanceof Error ? posture.error.message : 'Security posture unavailable'}
      </p>
    );
  if (!posture.data) return <p role="status">Checking security posture…</p>;
  const data = posture.data;
  const recent = [...(denials.data?.items ?? [])].reverse();
  return (
    <div className="space-y-6">
      <PostureHeader data={data} />
      <Checks checks={data.checks} />
      <Card>
        <CardHeader>
          <CardTitle>Destinations</CardTitle>
          <CardDescription>
            Everything this installation declares it may reach. Only bound destinations are
            reachable; the rest stay closed and their features queue or report unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Destinations destinations={data.destinations} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent denials</CardTitle>
          <CardDescription>
            Refused connections and operations, newest first. Inputs are recorded as digests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length ? (
            <Denials events={recent} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing has been denied.</p>
          )}
        </CardContent>
      </Card>
      <AuditLog data={data} />
    </div>
  );
}

function Destinations({ destinations }: { destinations: Posture['destinations'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Destination</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="text-right">Allowed</TableHead>
          <TableHead className="text-right">Denied</TableHead>
          <TableHead>Last used</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {destinations.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className="font-mono text-xs">{item.id}</div>
              <div className="text-xs text-muted-foreground">
                {item.owner}
                {item.origin ? ` · ${item.origin}` : ''}
              </div>
            </TableCell>
            <TableCell>{item.scope}</TableCell>
            <TableCell>
              <Badge variant={item.state === 'bound' ? 'secondary' : 'outline'}>{item.state}</Badge>
              {item.state !== 'bound' && item.offline && (
                <span className="ml-2 text-xs text-muted-foreground">offline: {item.offline}</span>
              )}
            </TableCell>
            <TableCell className="tabular text-right">{item.allowed}</TableCell>
            <TableCell className="tabular text-right">{item.denied}</TableCell>
            <TableCell className="text-xs">{time(item.lastUsedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Denials({ events }: { events: AuditEvent[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Seq</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Actor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.seq}>
            <TableCell className="tabular">{event.seq}</TableCell>
            <TableCell className="text-xs">{time(event.at)}</TableCell>
            <TableCell className="font-mono text-xs">{event.kind}</TableCell>
            <TableCell className="font-mono text-xs">
              {event.operation ?? String(event.data?.destination ?? '—')}
            </TableCell>
            <TableCell>{event.reason ?? '—'}</TableCell>
            <TableCell className="text-xs">
              {event.actor
                ? `${event.actor.principalId}${event.actor.via ? ` (${event.actor.via})` : ''}`
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
