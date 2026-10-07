import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Cpu, PackageCheck, ScanBarcode, Volume2, VolumeX } from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { defaultWedgeProfile, type ScannerProfile, type ScanRoute } from '@agent-native/devices';
import { deviceOperations } from '@agent-native/devices/contracts';
import { operations } from '../contracts';
import { type AttentionItem } from '@/components/attention-queue';
import { BigAction } from '@/components/big-action';
import { NumericPad } from '@/components/numeric-pad';
import { OperatorStation } from '@/components/operator-station';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import {
  DeliveryBadge,
  Freshness,
  StatusPill,
  type StationSignal,
} from '@/components/status-strip';
import { TilePicker } from '@/components/tile-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeedback } from '@/hooks/use-feedback';
import { useScanner } from '@/hooks/use-scanner';
import { client, live } from '@/lib/session';

type Station = OutputOf<typeof operations.stationGet>;
type Reading = Station['readings'][string];
type Attention = OutputOf<typeof operations.attentionList>['items'][number];

/** Matches the domain's freshness window: older observations are shown as stale. */
const FRESH_MS = 30_000;
/** Used until a supervisor saves site routes in device configuration. */
const defaultRoutes: readonly ScanRoute[] = [{ intent: 'order', pattern: '^(ORD-\\d{4,})$' }];

const machineSignal = (value: unknown): StationSignal =>
  value === 'RUNNING'
    ? 'ok'
    : value === 'ALARM'
      ? 'fault'
      : value === 'STOPPED'
        ? 'attention'
        : 'idle';
const reading = (station: Station, field: string): Reading | undefined => station.readings[field];
const shown = (value: Reading | undefined) =>
  value === undefined || value.value === null ? '—' : String(value.value);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Request failed');

/** Stations where the signed-in person holds a role. */
export function StationsScreen() {
  const stations = useQuery(live.liveQueryOptions(operations.stationList, {}));
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">LINE STATIONS</p>
        <h1 className="text-2xl font-semibold">Stations</h1>
        <p className="text-sm text-muted-foreground">
          Machine state is read from each station screen by its bridge. Orders and stop reasons come
          from the MES; classifications and counts are forwarded to it.
        </p>
      </header>
      {stations.error && <p role="alert">{stations.error.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stations.data?.items.map((station) => (
          <Card key={station.id}>
            <CardHeader>
              <CardDescription>{station.line}</CardDescription>
              <CardTitle>
                <Link to="/station/$stationId" params={{ stationId: station.id }}>
                  {station.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              <Badge variant={station.machine === 'RUNNING' ? 'secondary' : 'destructive'}>
                {station.stale ? 'No recent observation' : (station.machine ?? 'Unknown')}
              </Badge>
              {station.openStop && <Badge variant="outline">Open stop</Badge>}
              {station.attention > 0 && (
                <Badge variant="outline">{station.attention} to check</Badge>
              )}
              <Badge variant="outline">{station.mode}</Badge>
              <Badge variant="outline">{station.role}</Badge>
            </CardContent>
          </Card>
        ))}
        {stations.data?.items.length === 0 && <p>You hold no station role.</p>}
      </div>
    </div>
  );
}

/**
 * The station surface: one task at a time at glove density. Everything shown comes from live
 * queries and every action is a catalog command, so what an operator does here is exactly what
 * an agent could request over MCP, except the commands that need a person at the station.
 */
export function StationScreen() {
  const { stationId } = useParams({ from: '/station/$stationId' });
  const station = useQuery(live.liveQueryOptions(operations.stationGet, { station: stationId }));
  const attention = useQuery(
    live.liveQueryOptions(operations.attentionList, { station: stationId }),
  );
  if (station.error) return <p role="alert">{station.error.message}</p>;
  if (!station.data) return <p role="status">Loading station…</p>;
  return <StationSurface station={station.data} attention={attention.data?.items ?? []} />;
}

function StationSurface({
  station,
  attention,
}: {
  station: Station;
  attention: readonly Attention[];
}) {
  const feedback = useFeedback();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [correcting, setCorrecting] = useState<Attention>();
  const [correction, setCorrection] = useState('');
  const person = station.role !== 'viewer';
  const reasons = useQuery(live.liveQueryOptions(operations.reasonList, {}));
  const devices = useQuery(
    live.liveQueryOptions(deviceOperations.configGet, { station: station.id }),
  );

  /** Run one command; feedback is audible because the operator is looking at the machine. */
  const run = async (key: string, action: () => Promise<unknown>) => {
    setPending(key);
    setError(undefined);
    try {
      await action();
      feedback.play('accepted');
      return true;
    } catch (cause) {
      setError(message(cause));
      feedback.play('rejected');
      return false;
    } finally {
      setPending(undefined);
    }
  };

  const items: AttentionItem[] = attention.map((item) => {
    if (item.kind === 'reconcile')
      return {
        id: item.id,
        kind: 'reconcile',
        title: item.title,
        detail: item.detail,
        choices: [
          { value: 'applied', label: 'Yes, it took effect', tone: 'positive', hold: true },
          { value: 'not-applied', label: 'No, run it again', tone: 'neutral' },
        ],
      };
    const readable = item.proposed !== undefined && item.proposed !== null;
    return {
      id: item.id,
      kind: 'reading',
      title: item.title,
      detail: item.detail,
      proposed: readable ? String(item.proposed) : 'Unreadable',
      confidence: item.confidence,
      source: item.source,
      choices: [
        ...(readable
          ? [{ value: 'confirm', label: 'Matches the machine', tone: 'positive' as const }]
          : []),
        { value: 'correct', label: 'Enter the value', tone: 'neutral' as const },
      ],
    };
  });
  const resolve = (id: string, value: string) => {
    const item = attention.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === 'reconcile')
      return void run(`attention:${id}`, () =>
        client.command(operations.effectReconcile, {
          effectId: item.effectId!,
          applied: value === 'applied',
        }),
      );
    if (value === 'correct') {
      setCorrecting(item);
      setCorrection('');
      return;
    }
    void run(`attention:${id}`, () =>
      client.command(operations.readingConfirm, {
        attentionId: id,
        value: item.proposed as string | number | boolean,
      }),
    );
  };

  const machine = reading(station, 'machine');
  const alarm = reading(station, 'alarm');
  const { bridge, desired, currentStop: stop, order } = station;
  const seatLabel =
    bridge.seat === 'agent'
      ? 'Agent at screen'
      : bridge.seat === 'operator'
        ? 'Operator has the screen'
        : 'Screen idle';
  return (
    <OperatorStation
      title={station.name}
      context={`${station.line} · ${order ? `${order.id} · ${order.materialText}` : 'no active order'}`}
      headerActions={
        <>
          <Button
            asChild
            variant="outline"
            className="h-(--operator-target) text-(length:--operator-text)"
          >
            <Link to="/station/$stationId/devices" params={{ stationId: station.id }}>
              <ScanBarcode aria-hidden /> Scanner
            </Link>
          </Button>
          {station.role === 'supervisor' && (
            <Button
              asChild
              variant="outline"
              className="h-(--operator-target) text-(length:--operator-text)"
            >
              <Link to="/station/$stationId/bridge" params={{ stationId: station.id }}>
                <Cpu aria-hidden /> Bridge
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            className="h-(--operator-target) min-w-(--operator-target)"
            aria-label={feedback.muted ? 'Unmute feedback' : 'Mute feedback'}
            onClick={() => feedback.setMuted(!feedback.muted)}
          >
            {feedback.muted ? <VolumeX className="size-7" /> : <Volume2 className="size-7" />}
          </Button>
        </>
      }
      status={
        <>
          <StatusPill
            signal={bridge.stale ? 'idle' : machineSignal(machine?.value)}
            label={bridge.stale ? 'No recent observation' : shown(machine)}
            detail={
              <Freshness
                observedAt={machine?.observedAt}
                staleAfterMs={FRESH_MS}
                confidence={machine?.confidence}
              />
            }
          />
          {alarm?.value ? (
            <StatusPill signal="fault" label={String(alarm.value)} detail="Alarm" />
          ) : null}
          <StatusPill
            signal="idle"
            label={`Recipe ${shown(reading(station, 'recipe'))}`}
            detail="On the station screen"
          />
          <StatusPill
            signal={bridge.mode === 'monitor-only' ? 'idle' : 'pending'}
            label={bridge.mode}
            detail="Bridge mode"
          />
          <StatusPill signal={bridge.seat === 'agent' ? 'attention' : 'idle'} label={seatLabel} />
        </>
      }
      attention={items}
      onResolveAttention={person ? resolve : undefined}
      attentionPendingId={pending?.startsWith('attention:') ? pending.slice(10) : undefined}
      seat={
        person && bridge.mode !== 'monitor-only'
          ? {
              seat: bridge.seat,
              activity:
                desired?.sync === 'pending'
                  ? `Loading recipe ${desired.recipe} for ${desired.orderId}`
                  : undefined,
              pending: pending === 'seat',
              onTakeOver: () =>
                void run('seat', () =>
                  client.command(operations.seatRequest, { station: station.id, seat: 'operator' }),
                ),
              onHandBack: () =>
                void run('seat', () =>
                  client.command(operations.seatRequest, { station: station.id, seat: 'agent' }),
                ),
            }
          : undefined
      }
    >
      {error && (
        <p role="alert" className="text-(length:--operator-text) font-semibold text-op-fault">
          {error}
        </p>
      )}
      {correcting ? (
        <CorrectionEditor
          item={correcting}
          draft={correction}
          onDraft={setCorrection}
          pending={pending === `attention:${correcting.id}`}
          onSubmit={(value) =>
            void run(`attention:${correcting.id}`, () =>
              client.command(operations.readingConfirm, { attentionId: correcting.id, value }),
            ).then((ok) => ok && setCorrecting(undefined))
          }
        />
      ) : stop && (!stop.reason || stop.sync === 'rejected') && person ? (
        <TilePicker
          label={`Why did the machine stop?${stop.alarm ? ` Alarm: ${stop.alarm}` : ''}`}
          tiles={(reasons.data?.items ?? []).map((reason) => ({
            value: reason.code,
            label: reason.text,
            detail: reason.code,
            tone: reason.category === 'quality' ? ('caution' as const) : undefined,
          }))}
          selected={stop.reason}
          pending={pending === 'classify'}
          onPick={(reason) =>
            void run('classify', () =>
              client.command(operations.stopClassify, { stopId: stop.id, reason }),
            )
          }
        />
      ) : (
        <OrderTask
          station={station}
          person={person}
          pending={pending}
          run={run}
          profile={devices.data?.scanners[0]}
          routes={devices.data?.routes.length ? devices.data.routes : defaultRoutes}
        />
      )}
      {desired && (
        <section
          aria-label="Requested recipe"
          className="flex flex-wrap items-center gap-3 text-(length:--operator-text)"
        >
          <span>
            Recipe <strong>{desired.recipe}</strong> for {desired.orderId}, requested by{' '}
            {desired.requestedBy}
          </span>
          <DeliveryBadge state={desired.sync} reason={desired.rejection} />
          {desired.holdReason && <span className="text-op-attention">{desired.holdReason}</span>}
        </section>
      )}
      <Counters station={station} person={person} pending={pending} run={run} />
      <RecentStops station={station.id} />
    </OperatorStation>
  );
}

function OrderTask({
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
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  profile: ScannerProfile | undefined;
  routes: readonly ScanRoute[];
}) {
  const feedback = useFeedback();
  const orders = useQuery(live.liveQueryOptions(operations.orderList, { station: station.id }));
  const [candidate, setCandidate] = useState<string>();
  const [scan, setScan] = useState<ScanOutcome>();
  const released = (orders.data?.items ?? []).filter((order) => order.status === 'released');
  const choose = (value: string, how: string) => {
    const found = released.find((order) => order.id === value);
    setScan({
      value,
      ok: found !== undefined,
      message: found ? `${how}: ${found.materialText}` : 'Not a released order for this station',
    });
    feedback.play(found ? 'scan' : 'rejected');
    setCandidate(found?.id);
  };
  const scanner = useScanner({
    profile: profile ?? defaultWedgeProfile(),
    routes,
    enabled: person,
    onRoute: (routed) => routed.intent === 'order' && choose(routed.value, 'Scanned'),
  });
  const chosen = released.find((order) => order.id === candidate);
  const loading = station.desired?.sync === 'pending';
  if (!person) return null;
  return (
    <div className="space-y-(--operator-gap)">
      <ScanPrompt
        prompt="Scan the next order"
        hint={
          scanner.error ??
          'Starting an order loads its recipe on the station screen. The machine must be stopped.'
        }
        last={scan}
        onManual={(value) => choose(value.trim(), 'Typed')}
      />
      {released.length > 0 && (
        <TilePicker
          label="Released orders"
          tiles={released.map((order) => ({
            value: order.id,
            label: order.id,
            detail: `${order.recipe} · ${order.materialText}`,
          }))}
          selected={candidate}
          onPick={(value) => choose(value, 'Picked')}
          hotkeys={false}
        />
      )}
      {chosen && (
        <BigAction
          tone="positive"
          hold
          icon={<PackageCheck aria-hidden />}
          label={`Start ${chosen.id}`}
          description={`Hold to load recipe ${chosen.recipe} on the station`}
          pending={pending === 'start'}
          disabled={loading}
          onAction={() =>
            void run('start', () =>
              client.command(operations.orderStart, { station: station.id, orderId: chosen.id }),
            ).then((ok) => ok && setCandidate(undefined))
          }
        />
      )}
    </div>
  );
}

function Counters({
  station,
  person,
  pending,
  run,
}: {
  station: Station;
  person: boolean;
  pending: string | undefined;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const good = reading(station, 'good');
  const scrap = reading(station, 'scrap');
  const usable = (value: Reading | undefined) =>
    value !== undefined && value.value !== null && !value.stale;
  return (
    <section
      aria-label="Counters"
      className="grid gap-(--operator-gap) sm:grid-cols-[1fr_1fr_auto]"
    >
      {(
        [
          ['Good', good],
          ['Scrap', scrap],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="tabular text-4xl font-semibold">{shown(value)}</div>
          <Freshness
            observedAt={value?.observedAt}
            staleAfterMs={FRESH_MS}
            confidence={value?.confidence}
          />
          {value?.status === 'operator-verified' && (
            <div className="text-sm">Checked by {value.verifiedBy}</div>
          )}
        </div>
      ))}
      {person && station.order?.status === 'active' && (
        <BigAction
          hold
          label="Confirm counts"
          description="Send these counters to the MES"
          disabled={!usable(good) || !usable(scrap)}
          pending={pending === 'counts'}
          onAction={() =>
            void run('counts', () =>
              client.command(
                operations.countConfirm,
                { station: station.id },
                // The counters the operator looked at; changed counts conflict instead of sending.
                { expectedRevisions: { [`counters:${station.id}`]: station.countersRevision } },
              ),
            )
          }
        />
      )}
    </section>
  );
}

function RecentStops({ station }: { station: string }) {
  const stops = useQuery(live.liveQueryOptions(operations.stopList, { station, limit: 5 }));
  if (!stops.data?.items.length) return null;
  return (
    <section aria-label="Recent stops" className="space-y-2">
      <h2 className="text-(length:--operator-text) font-semibold">Recent stops</h2>
      <ul className="divide-y rounded-xl border">
        {stops.data.items.map((stop) => (
          <li key={stop.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="tabular">{new Date(stop.startedAt).toLocaleTimeString()}</span>
            <span>{stop.state}</span>
            {stop.alarm && <span className="text-muted-foreground">{stop.alarm}</span>}
            <span className="flex-1">{stop.reason ?? 'Not classified'}</span>
            {stop.sync && (
              <DeliveryBadge state={stop.sync} reference={stop.sorRef} reason={stop.rejection} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Back link shared by the station sub-screens. */
export function StationBackLink({ station }: { station: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      onClick={() => void navigate({ to: '/station/$stationId', params: { stationId: station } })}
    >
      ← Station
    </Button>
  );
}

/**
 * Enter the value shown on the machine in the form the profile declares for the field: a keypad
 * for numbers, tiles for options and yes/no, a text field for text. A blank entry is never sent.
 */
function CorrectionEditor({
  item,
  draft,
  onDraft,
  pending,
  onSubmit,
}: {
  item: Attention;
  draft: string;
  onDraft: (value: string) => void;
  pending: boolean;
  onSubmit: (value: string | number | boolean) => void;
}) {
  const label = `${item.title}: value on the machine`;
  const declared = item.value ?? { type: 'text' as const };
  if (declared.type === 'number')
    return (
      <NumericPad
        label={label}
        value={draft}
        onChange={onDraft}
        onSubmit={onSubmit}
        pending={pending}
        unit={declared.unit}
        decimals={declared.decimals ?? 0}
      />
    );
  if (declared.type === 'enum' || declared.type === 'boolean')
    return (
      <TilePicker
        label={label}
        pending={pending}
        tiles={
          declared.type === 'boolean'
            ? [
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ]
            : (declared.options ?? []).map((option) => ({ value: option, label: option }))
        }
        onPick={(value) => onSubmit(declared.type === 'boolean' ? value === 'true' : value)}
      />
    );
  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onSubmit(draft.trim());
      }}
    >
      <Input
        aria-label={label}
        className="h-14 text-(length:--operator-text)"
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        autoFocus
      />
      <Button type="submit" size="lg" disabled={pending || !draft.trim()}>
        Confirm
      </Button>
    </form>
  );
}
