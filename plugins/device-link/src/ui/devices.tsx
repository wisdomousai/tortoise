import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { deviceLinkOperations as ops } from '../contracts';
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

type Device = OutputOf<typeof ops.deviceList>['devices'][number];
type Created = OutputOf<typeof ops.enrollmentCreate>;

const time = (at: number) => new Date(at).toLocaleString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Five-character groups, as the device accepts them with or without the dash. */
const grouped = (code: string) => code.match(/.{1,5}/g)!.join('-');

/** A new enrollment: label and kind, then the one-use code to type on the device. */
function Enroll({ onError }: { onError: (message: string) => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'field-sync' | 'attached'>('field-sync');
  const [created, setCreated] = useState<Created & { label: string }>();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pair a device</CardTitle>
        <CardDescription>
          A phone delivers captures and reads assignments. A tablet shows these screens as you,
          until it is revoked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void client
              .command(ops.enrollmentCreate, { label, kind })
              .then((receipt) => {
                setCreated({ ...(receipt.result as Created), label });
                setLabel('');
              })
              .catch((error) => onError(message(error)));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="device-label">Name</Label>
            <Input
              id="device-label"
              placeholder="Phone 3"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="device-kind">Kind</Label>
            <NativeSelect
              id="device-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="field-sync">Phone</option>
              <option value="attached">Tablet</option>
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
              <p>{`Hub address: ${location.origin}`}</p>
              <p>{`Valid once, until ${time(created.expiresAt)}.`}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeviceRow({ device, onError }: { device: Device; onError: (message: string) => void }) {
  const [label, setLabel] = useState(device.label);
  const revoked = device.revokedAt !== undefined;
  return (
    <TableRow>
      <TableCell>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void client
              .command(ops.deviceRename, { deviceId: device.id, label })
              .catch((error) => onError(message(error)));
          }}
        >
          <Input
            aria-label={`Name of ${device.label}`}
            value={label}
            maxLength={80}
            disabled={revoked}
            onChange={(event) => setLabel(event.target.value)}
          />
          {label !== device.label && !revoked ? (
            <Button type="submit" variant="outline">
              Rename
            </Button>
          ) : null}
        </form>
      </TableCell>
      <TableCell>{device.kind === 'attached' ? 'Tablet' : 'Phone'}</TableCell>
      <TableCell>{device.enrolledBy}</TableCell>
      <TableCell>{time(device.enrolledAt)}</TableCell>
      <TableCell>
        {revoked ? (
          <Badge variant="outline">{`Revoked ${time(device.revokedAt!)}`}</Badge>
        ) : (
          <Button
            variant="destructive"
            onClick={() =>
              void client
                .command(ops.deviceRevoke, { deviceId: device.id })
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

/**
 * Paired devices (`link.device.list`): create an enrollment code, rename a device, and revoke
 * it. Revocation applies to the device's next request.
 */
export function DevicesScreen() {
  const [error, setError] = useState<string>();
  const listed = useQuery(live.liveQueryOptions(ops.deviceList, {}));
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
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent>
          {listed.error ? (
            <p role="alert" className="text-sm text-destructive">
              {message(listed.error)}
            </p>
          ) : !listed.data ? (
            <p role="status">Reading devices…</p>
          ) : listed.data.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No device is paired.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Enrolled by</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.data.devices.map((device) => (
                  <DeviceRow key={device.id} device={device} onError={setError} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
