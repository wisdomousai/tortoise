import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { deviceOperations } from '@agent-native/devices/contracts';
import { OperatorPanel, OperatorStation } from '@/components/operator-station';
import { client, live } from '@/lib/session';
import { operations } from '../../contracts';
import { toAttentionItems } from './attention-items';
import { CorrectionEditor } from './correction-editor';
import { defaultRoutes, type Attention, type Station } from './format';
import { MachineBanner } from './machine-banner';
import { ProductionTask } from './production-task';
import { RecentStops } from './recent-stops';
import { RequestedRecipe } from './requested-recipe';
import { StationBack, StationHeaderActions } from './station-header';
import { StopReasons } from './stop-reasons';
import { useAttention } from './use-attention';
import { useProposals } from './use-proposals';
import { useStationCommands, type Run } from './use-station-commands';

/**
 * The station surface: one task at a time at glove density. Everything shown comes from live
 * queries and every action is a catalog command, so what an operator does here is exactly what
 * an agent could request over MCP, except the commands that need a person at the station.
 */
export function StationScreen() {
  const { stationId } = useParams({ strict: false }) as { stationId: string };
  const station = useQuery(live.liveQueryOptions(operations.stationGet, { station: stationId }));
  const attention = useQuery(
    live.liveQueryOptions(operations.attentionList, { station: stationId }),
  );
  if (station.error) return <p role="alert">{station.error.message}</p>;
  if (!station.data) return <p role="status">Loading station…</p>;
  return <StationSurface station={station.data} attention={attention.data?.items ?? []} />;
}

/**
 * Take over or hand back the station screen. Absent when the bridge only watches the screen,
 * since there is then no seat to take.
 */
function seatControl(station: Station, pending: string | undefined, run: Run) {
  const { bridge, desired } = station;
  if (bridge.mode === 'monitor-only') return undefined;
  const request = (seat: 'operator' | 'agent') => () =>
    void run('seat', () => client.command(operations.seatRequest, { station: station.id, seat }));
  return {
    seat: bridge.seat,
    activity:
      desired?.sync === 'pending'
        ? `Loading recipe ${desired.recipe} for ${desired.orderId}`
        : undefined,
    pending: pending === 'seat',
    onTakeOver: request('operator'),
    onHandBack: request('agent'),
  };
}

/**
 * Holds what outlives a single task: the command in flight and the reading being corrected,
 * which stays open across live updates until it is confirmed.
 */
function StationSurface({
  station,
  attention,
}: {
  station: Station;
  attention: readonly Attention[];
}) {
  const { feedback, pending, error, run } = useStationCommands();
  const person = station.role !== 'viewer';
  const reasons = useQuery(live.liveQueryOptions(operations.reasonList, {}));
  const devices = useQuery(
    live.liveQueryOptions(deviceOperations.configGet, { station: station.id }),
  );
  const { correcting, correction, setCorrection, resolve, submit } = useAttention(attention, run);
  const { desired, currentStop: stop } = station;
  const proposals = useProposals(stop?.id, run);
  const classify = stop && (!stop.reason || stop.sync === 'rejected') && person;
  return (
    <OperatorStation
      title={station.name}
      context={`${station.line} · ${station.role}`}
      back={<StationBack />}
      headerActions={
        <StationHeaderActions
          station={station}
          person={person}
          muted={feedback.muted}
          onMuted={feedback.setMuted}
        />
      }
      banner={<MachineBanner station={station} />}
      attention={[...proposals.items, ...toAttentionItems(attention)]}
      onResolveAttention={
        person ? (id, value) => proposals.resolve(id, value) || resolve(id, value) : undefined
      }
      attentionPendingId={pending?.startsWith('attention:') ? pending.slice(10) : undefined}
      seat={person ? seatControl(station, pending, run) : undefined}
      footer={<RecentStops station={station.id} />}
    >
      {error && (
        <p
          role="alert"
          className="rounded-2xl bg-op-fault/10 px-6 py-4 text-(length:--operator-text) font-semibold text-op-fault"
        >
          {error}
        </p>
      )}
      {correcting ? (
        <OperatorPanel title={correcting.title} aside="Enter what the machine shows">
          <CorrectionEditor
            item={correcting}
            draft={correction}
            onDraft={setCorrection}
            pending={pending === `attention:${correcting.id}`}
            onSubmit={(value) => submit(correcting, value)}
          />
        </OperatorPanel>
      ) : classify ? (
        <StopReasons stop={stop} reasons={reasons.data?.items ?? []} pending={pending} run={run} />
      ) : (
        <ProductionTask
          station={station}
          person={person}
          pending={pending}
          run={run}
          profile={devices.data?.scanners[0]}
          routes={devices.data?.routes.length ? devices.data.routes : defaultRoutes}
        />
      )}
      {desired && <RequestedRecipe desired={desired} />}
    </OperatorStation>
  );
}
