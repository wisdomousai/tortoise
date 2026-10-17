import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { driverOperations } from '@agent-native/connector-driver/contracts';
import { Badge } from '@/components/ui/badge';
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

type Driver = OutputOf<typeof driverOperations.statusGet>['drivers'][number];
// Driver status lives in host memory without a change feed, so the screen polls.
const POLL_MS = 3_000;

const stateTone = {
  ready: 'secondary',
  starting: 'outline',
  stopped: 'outline',
  'backing-off': 'destructive',
} as const;
const hazardTone = {
  none: 'secondary',
  low: 'outline',
  'operator-present': 'destructive',
} as const;

function Devices({ driver }: { driver: Driver }) {
  if (!driver.devices.length)
    return <p className="text-sm text-muted-foreground">No unit reported yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {driver.devices.map((device, index) => (
        <li key={device.serial ?? index}>
          {device.model ?? 'Unit'} <span className="font-mono">{device.serial ?? '—'}</span>
          {device.firmware && (
            <span className="text-muted-foreground"> · firmware {device.firmware}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Actions({ driver }: { driver: Driver }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead>Hazard</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {driver.actions.map((action) => (
          <TableRow key={action.id}>
            <TableCell>
              <div>{action.title}</div>
              <div className="font-mono text-xs text-muted-foreground">{action.id}</div>
            </TableCell>
            <TableCell>{action.delivery}</TableCell>
            <TableCell>
              <Badge variant={hazardTone[action.hazard]}>{action.hazard}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DriverCard({ driver }: { driver: Driver }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {driver.title}
          <Badge variant={stateTone[driver.state]} aria-label={`Driver ${driver.state}`}>
            {driver.state}
          </Badge>
        </CardTitle>
        <CardDescription>
          Contract <span className="font-mono">{driver.id}</span> {driver.version}
          {driver.driver && (
            <>
              , driver {driver.driver.id} {driver.driver.version}
            </>
          )}
          . Started {driver.starts} {driver.starts === 1 ? 'time' : 'times'}, {driver.problems}{' '}
          {driver.problems === 1 ? 'problem' : 'problems'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {driver.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {driver.lastError}
          </p>
        )}
        <Devices driver={driver} />
        <Actions driver={driver} />
      </CardContent>
    </Card>
  );
}

/**
 * Read-only status of the application's hardware drivers: process state, the units each driver
 * reported, and each action's delivery mode and hazard class. Nothing here acts on equipment.
 */
export function DriverScreen() {
  const status = useQuery({
    ...live.liveQueryOptions(driverOperations.statusGet, {}),
    refetchInterval: POLL_MS,
  });
  if (status.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {status.error instanceof Error ? status.error.message : 'Driver status unavailable'}
      </p>
    );
  if (!status.data) return <p role="status">Reading driver status…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Drivers</h1>
      {status.data.drivers.length ? (
        status.data.drivers.map((driver) => <DriverCard key={driver.id} driver={driver} />)
      ) : (
        <p className="text-sm text-muted-foreground">This application declares no driver.</p>
      )}
    </div>
  );
}
