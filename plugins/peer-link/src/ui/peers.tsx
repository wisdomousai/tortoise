import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { peerLinkOperations as ops } from '../contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client, live } from '@/lib/session';

type Peer = OutputOf<typeof ops.list>['peers'][number];
type Created = OutputOf<typeof ops.enrollmentCreate>;

const time = (at: number) => new Date(at).toLocaleString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const grouped = (code: string) => code.match(/.{1,5}/g)!.join('-');

/** A new enrollment: a name and how subjects map, then the one-use code for the other application. */
function Enroll({ onError }: { onError: (message: string) => void }) {
  const [label, setLabel] = useState('');
  const [subjects, setSubjects] = useState<'mapped' | 'same'>('mapped');
  const [created, setCreated] = useState<Created & { label: string }>();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enroll an application</CardTitle>
        <CardDescription>
          The other application calls this one with its own credential, and on behalf of the people
          its users are mapped to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void client
              .command(ops.enrollmentCreate, { label, subjects })
              .then((receipt) => {
                setCreated({ ...(receipt.result as Created), label });
                setLabel('');
              })
              .catch((error) => onError(message(error)));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="peer-label">Name</Label>
            <Input
              id="peer-label"
              placeholder="Receiving"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="peer-subjects">People</Label>
            <NativeSelect
              id="peer-subjects"
              value={subjects}
              onChange={(event) => setSubjects(event.target.value as typeof subjects)}
            >
              <option value="mapped">Mapped one by one</option>
              <option value="same">Same sign-in on both</option>
            </NativeSelect>
          </div>
          <Button type="submit">Create code</Button>
        </form>
        {created ? (
          <Alert>
            <AlertTitle>{`Code for ${created.label}`}</AlertTitle>
            <AlertDescription className="space-y-1">
              <p className="font-mono text-2xl tracking-widest" aria-label="Enrollment code">
                {grouped(created.code)}
              </p>
              <p>{`Address: ${location.origin}`}</p>
              <p>{`Valid once, until ${time(created.expiresAt)}.`}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PeerRow({ peer, onError }: { peer: Peer; onError: (message: string) => void }) {
  return (
    <TableRow>
      <TableCell>{peer.label}</TableCell>
      <TableCell>
        {peer.contract ? `${peer.application} ${peer.contract.contractVersion}` : peer.application}
      </TableCell>
      <TableCell>{peer.subjects === 'same' ? 'Same sign-in' : 'Mapped'}</TableCell>
      <TableCell>{time(peer.enrolledAt)}</TableCell>
      <TableCell>
        {peer.revokedAt !== undefined ? (
          <Badge variant="outline">{`Revoked ${time(peer.revokedAt)}`}</Badge>
        ) : (
          <Button
            variant="destructive"
            onClick={() =>
              void client
                .command(ops.revoke, { peerId: peer.id })
                .catch((error) => onError(message(error)))
            }
          >
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Who a peer's subjects are here: map a subject to a person, list and remove mappings. */
function Subjects({
  peers,
  onError,
}: {
  peers: readonly Peer[];
  onError: (message: string) => void;
}) {
  const active = peers.filter((peer) => peer.revokedAt === undefined);
  const [peerId, setPeerId] = useState('');
  const [subject, setSubject] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const listed = useQuery(live.liveQueryOptions(ops.subjectList, {}));
  const labelOf = (id: string) => peers.find((peer) => peer.id === id)?.label ?? id;
  const chosen = peerId || active[0]?.id || '';
  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>
          A call on behalf of a subject acts as the person it is mapped to, under that person's
          access here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {active.length ? (
          <form
            className="grid gap-2 sm:grid-cols-[12rem_1fr_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void client
                .command(ops.subjectMap, { peerId: chosen, subject, principalId })
                .then(() => {
                  setSubject('');
                  setPrincipalId('');
                })
                .catch((error) => onError(message(error)));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="subject-peer">Application</Label>
              <NativeSelect
                id="subject-peer"
                value={chosen}
                onChange={(event) => setPeerId(event.target.value)}
              >
                {active.map((peer) => (
                  <option key={peer.id} value={peer.id}>
                    {peer.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="subject-name">Their user</Label>
              <Input
                id="subject-name"
                value={subject}
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="subject-person">Person here</Label>
              <Input
                id="subject-person"
                value={principalId}
                maxLength={200}
                onChange={(event) => setPrincipalId(event.target.value)}
                required
              />
            </div>
            <Button type="submit">Map</Button>
          </form>
        ) : null}
        {listed.error ? (
          <p role="alert" className="text-destructive">
            {message(listed.error)}
          </p>
        ) : !listed.data ? (
          <p role="status">Reading mappings…</p>
        ) : listed.data.mappings.length === 0 ? (
          <p className="text-muted-foreground">No subject is mapped.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Their user</TableHead>
                <TableHead>Person here</TableHead>
                <TableHead>Mapped</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listed.data.mappings.map((mapping) => (
                <TableRow key={`${mapping.peerId}/${mapping.subject}`}>
                  <TableCell>{labelOf(mapping.peerId)}</TableCell>
                  <TableCell>{mapping.subject}</TableCell>
                  <TableCell>{mapping.principalId}</TableCell>
                  <TableCell>{time(mapping.mappedAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void client
                          .command(ops.subjectUnmap, {
                            peerId: mapping.peerId,
                            subject: mapping.subject,
                          })
                          .catch((error) => onError(message(error)))
                      }
                    >
                      Unmap
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Applications that call this one (`peer.list`): create an enrollment code, revoke a peer, and
 * map its subjects to people. Revocation and unmapping apply to the peer's next request.
 */
export function PeersScreen() {
  const [error, setError] = useState<string>();
  const listed = useQuery(live.liveQueryOptions(ops.list, {}));
  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Enroll onError={setError} />
      <Card>
        <CardHeader>
          <CardTitle>Applications calling this one</CardTitle>
        </CardHeader>
        <CardContent>
          {listed.error ? (
            <p role="alert" className="text-sm text-destructive">
              {message(listed.error)}
            </p>
          ) : !listed.data ? (
            <p role="status">Reading peers…</p>
          ) : listed.data.peers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No application is enrolled.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.data.peers.map((peer) => (
                  <PeerRow key={peer.id} peer={peer} onError={setError} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {listed.data ? <Subjects peers={listed.data.peers} onError={setError} /> : null}
    </div>
  );
}
