import type { ScannerProfile, ScanRoute } from '@agent-native/devices';
import { OperatorPanel } from '@/components/operator-station';
import { reading, type Station } from './format';
import { Counters } from './counters';
import { OrderTask } from './order-task';
import type { Run } from './use-station-commands';

/**
 * What to do when nothing needs correcting or classifying: count against an active order,
 * nothing while the machine runs without one, or start an order while it is stopped.
 */
export function ProductionTask({
  station,
  person,
  pending,
  run,
  profile,
  routes,
}: {
  station: Station;
  person: boolean;
  pending: string | undefined;
  run: Run;
  profile: ScannerProfile | undefined;
  routes: readonly ScanRoute[];
}) {
  const { bridge, order } = station;
  const running = !bridge.stale && reading(station, 'machine')?.value === 'RUNNING';
  return (
    <>
      {order?.status === 'active' && (
        <Counters station={station} person={person} pending={pending} run={run} />
      )}
      {running && order?.status !== 'active' && (
        <OperatorPanel title="Nothing to do here">
          <p className="text-muted-foreground">
            The machine runs without an active MES order. Counters appear here once an order is
            active; a new order can be started when the machine stops.
          </p>
        </OperatorPanel>
      )}
      {!running && (
        <OrderTask
          station={station}
          person={person}
          pending={pending}
          run={run}
          profile={profile}
          routes={routes}
        />
      )}
    </>
  );
}
