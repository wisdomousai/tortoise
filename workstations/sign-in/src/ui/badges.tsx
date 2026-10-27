import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { stationPaths, stationSignInOperations as ops } from '../contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client, live } from '@/lib/session';

type Listed = OutputOf<typeof ops.badgeList>;
type Enrolled = Listed['badges'][number];

const time = (at: number) => new Date(at).toLocaleString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function status(badge: Enrolled, now: number) {
  if (badge.revokedAt !== undefined) return <Badge variant="outline">Revoked</Badge>;
  if (badge.lockedUntil !== undefined && badge.lockedUntil > now)
    return <Badge variant="destructive">Locked until {time(badge.lockedUntil)}</Badge>;
  return <Badge variant="secondary">Active</Badge>;
}

/**
 * Enrollment posts to the station route, which hashes the PIN and enrolls the badge as the
 * signed-in admin, so neither the badge value nor the PIN becomes a stored command input.
 */
function Enroll({ onError }: { onError: (message: string) => void }) {
  const empty = { principalId: '', label: '', badge: '', pin: '' };
  const [form, setForm] = useState(empty);
  const [pending, setPending] = useState(false);
  const field = (key: keyof typeof empty) => ({
    id: `badge-${key}`,
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
    required: true,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enroll a badge</CardTitle>
        <CardDescription>
          The person signs in at a seat with this badge and PIN. Scan the badge into its field or
          type its number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            void fetch(stationPaths.enroll, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(form),
            })
              .then(async (response) => {
                if (response.ok) return setForm(empty);
                const body = (await response.json().catch(() => undefined)) as
                  { error?: { message?: string } } | undefined;
                onError(body?.error?.message ?? `Enrollment answered ${response.status}`);
              })
              .catch((error) => onError(message(error)))
              .finally(() => setPending(false));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="badge-principalId">Person</Label>
            <Input {...field('principalId')} maxLength={256} placeholder="ana" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="badge-label">Label</Label>
            <Input {...field('label')} maxLength={80} placeholder="Ana Lima, bench 2" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="badge-badge">Badge</Label>
            <Input {...field('badge')} maxLength={256} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="badge-pin">PIN</Label>
            <Input
              {...field('pin')}
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              title="4 to 8 digits"
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="sm:col-span-2 sm:justify-self-start" disabled={pending}>
            Enroll
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Enrolled badges and open operator sessions, for the station's admin. */
export function BadgesScreen() {
  const [error, setError] = useState<string>();
  const listed = useQuery(live.liveQueryOptions(ops.badgeList, {}));
  const { badges = [], sessions = [] } = (listed.data ?? {}) as Partial<Listed>;
  const now = Date.now();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Badges</h1>
      {(error ?? listed.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? message(listed.error)}</AlertDescription>
        </Alert>
      )}
      <Enroll onError={setError} />
      <Card>
        <CardHeader>
          <CardTitle>Enrolled badges</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {badges.map((badge) => (
                <TableRow key={badge.id}>
                  <TableCell>{badge.label}</TableCell>
                  <TableCell>{badge.principalId}</TableCell>
                  <TableCell>{time(badge.enrolledAt)}</TableCell>
                  <TableCell>{status(badge, now)}</TableCell>
                  <TableCell className="text-right">
                    {badge.revokedAt === undefined && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void client
                            .command(ops.badgeRevoke, { badgeId: badge.id })
                            .catch((failure) => setError(message(failure)))
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Open sessions</CardTitle>
          <CardDescription>Revoking a badge ends its sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is signed in at a seat.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.principalId}</TableCell>
                    <TableCell>{session.seat}</TableCell>
                    <TableCell>{time(session.startedAt)}</TableCell>
                    <TableCell>{time(session.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
