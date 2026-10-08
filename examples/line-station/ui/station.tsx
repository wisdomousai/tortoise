import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ChevronLeft,
  Cpu,
  OctagonAlert,
  PackageCheck,
  ScanBarcode,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { defaultWedgeProfile, type ScannerProfile, type ScanRoute } from '@agent-native/devices';
import { deviceOperations } from '@agent-native/devices/contracts';
import { operations } from '../contracts';
import { type AttentionItem } from '@/components/attention-queue';
import { BigAction } from '@/components/big-action';
import { NumericPad } from '@/components/numeric-pad';
import { OperatorPanel, OperatorStation } from '@/components/operator-station';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import {
  DeliveryBadge,
  Freshness,
  SignalBanner,
  type StationSignal,
} from '@/components/status-strip';
import { TilePicker } from '@/components/tile-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFeedback } from '@/hooks/use-feedback';
import { useScanner } from '@/hooks/use-scanner';
import { client, live } from '@/lib/session';
import { cn } from '@/lib/utils';

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

/** What a station card and the banner say about the machine. */
const machineWord = (machine: string | undefined, stale: boolean) =>
  stale ? 'Not seen' : (machine ?? 'Unknown').toLowerCase();
const cardTone = (machine: string | undefined, stale: boolean) =>
  stale
    ? 'bg-op-idle text-op-idle-foreground'
    : machine === 'RUNNING'
      ? 'bg-op-ok text-op-ok-foreground'
      : machine === 'ALARM'
        ? 'bg-op-fault text-op-fault-foreground'
        : machine === 'STOPPED'
          ? 'bg-op-attention text-op-attention-foreground'
          : 'bg-op-idle text-op-idle-foreground';
const modeWord: Record<Station['mode'], string> = {
  'monitor-only': 'Watching only',
  assist: 'Assists',
  actuate: 'Loads recipes',
};

/** Stations where the signed-in person holds a role; each opens full window at the machine. */
export function StationsScreen() {
  const stations = useQuery(live.liveQueryOptions(operations.stationList, {}));
  const items = stations.data?.items ?? [];
  const count = (test: (station: (typeof items)[number]) => boolean) => items.filter(test).length;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Stations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read live from each station&apos;s own screen. Open one to run it full screen at the
            machine.
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {[
              [count((station) => !station.stale && station.machine !== 'RUNNING'), 'stopped'],
              [count((station) => !station.stale && station.machine === 'RUNNING'), 'running'],
              [count((station) => station.stale), 'not seen'],
            ]
              .filter(([value]) => value)
              .map(([value, word]) => `${value} ${word}`)
              .join(' · ')}
          </span>
        )}
      </header>
      {stations.error && <p role="alert">{stations.error.message}</p>}
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
        {items.map((station) => {
          const needsPerson = station.openStop || station.attention > 0;
          return (
            <Link
              key={station.id}
              to="/station/$stationId"
              params={{ stationId: station.id }}
              aria-label={`${station.name}, ${machineWord(station.machine, station.stale)}`}
              className={cn(
                'flex flex-col overflow-hidden rounded-2xl border bg-card hover:shadow-md',
                needsPerson && 'border-2 border-op-attention',
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-3 px-4.5 py-4 text-xl font-bold tracking-wide uppercase',
                  cardTone(station.machine, station.stale),
                )}
              >
                {machineWord(station.machine, station.stale)}
              </div>
              <div className="flex flex-col gap-2 px-4.5 py-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold">{station.name}</span>
                  <span className="text-sm text-muted-foreground">{station.line}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {station.openStop && <Chip tone="attention">Stop not classified</Chip>}
                  {station.attention > 0 && (
                    <Chip tone="attention">
                      {station.attention} {station.attention === 1 ? 'reading' : 'readings'} to
                      check
                    </Chip>
                  )}
                  <Chip>{modeWord[station.mode]}</Chip>
                  <Chip>{station.role}</Chip>
                </div>
              </div>
            </Link>
          );
        })}
        {stations.data && items.length === 0 && <p>You hold no station role.</p>}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone?: 'attention'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[0.8rem]',
        tone === 'attention' ? 'bg-op-attention/20 font-medium' : 'bg-muted',
      )}
    >
      {children}
    </span>
  );
}

/** Sidebar status: what the MES and the station screens still have to accept. */
export function MesStatus() {
  const sync = useQuery(live.liveQueryOptions(operations.syncStatus, {}));
  if (!sync.data) return null;
  const totals = sync.data.targets.reduce(
    (sum, target) => ({
      open: sum.open + target.pending + target.retrying,
      held: sum.held + target.held,
      rejected: sum.rejected + target.rejected,
    }),
    { open: 0, held: 0, rejected: 0 },
  );
  return (
    <div className="space-y-1">
      <p className="font-medium text-sidebar-foreground">
        {totals.rejected
          ? `${totals.rejected} rejected`
          : totals.held
            ? `${totals.held} to reconcile`
            : totals.open
              ? `${totals.open} sending`
              : 'MES: all sent'}
      </p>
      {sync.data.lastSyncAt !== undefined && (
        <p>
          Orders synced{' '}
          {new Date(sync.data.lastSyncAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
    </div>
  );
}

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
  const classify = stop && (!stop.reason || stop.sync === 'rejected') && person;
  const running = !bridge.stale && machine?.value === 'RUNNING';
  const headerButton =
    'h-(--operator-target) min-w-(--operator-target) border-0 bg-background/15 text-(length:--operator-text) text-background hover:bg-background/25 hover:text-background';
  return (
    <OperatorStation
      title={station.name}
      context={`${station.line} · ${station.role}`}
      back={
        <Button asChild className={headerButton}>
          <Link to="/station" aria-label="All stations">
            <ChevronLeft className="size-8" aria-hidden />
          </Link>
        </Button>
      }
      headerActions={
        <>
          {!person || bridge.mode === 'monitor-only' ? (
            <span className="hidden text-base leading-tight opacity-80 md:block">
              {seatLabel}
              <br />
              {bridge.mode === 'monitor-only'
                ? 'Watching the station screen'
                : modeWord[bridge.mode]}
            </span>
          ) : null}
          <Button asChild className={headerButton}>
            <Link to="/station/$stationId/devices" params={{ stationId: station.id }}>
              <ScanBarcode aria-hidden /> Scanner
            </Link>
          </Button>
          {station.role === 'supervisor' && (
            <Button asChild className={headerButton}>
              <Link to="/station/$stationId/bridge" params={{ stationId: station.id }}>
                <Cpu aria-hidden /> Bridge
              </Link>
            </Button>
          )}
          <Button
            className={headerButton}
            aria-label={feedback.muted ? 'Unmute feedback' : 'Mute feedback'}
            onClick={() => feedback.setMuted(!feedback.muted)}
          >
            {feedback.muted ? <VolumeX className="size-7" /> : <Volume2 className="size-7" />}
          </Button>
        </>
      }
      banner={
        <section aria-label="Machine" className="flex flex-wrap gap-(--operator-gap)">
          <SignalBanner
            className="flex-[1_1_22rem]"
            signal={bridge.stale ? 'idle' : machineSignal(machine?.value)}
            label={bridge.stale ? 'Not seen' : shown(machine)}
            detail={
              <>
                {stop && !stop.endedAt && !bridge.stale && <>for {since(stop.startedAt)} · </>}
                seen{' '}
                <Freshness
                  observedAt={machine?.observedAt}
                  staleAfterMs={FRESH_MS}
                  confidence={machine?.confidence}
                />
              </>
            }
          />
          <div className="flex min-w-0 flex-[2_1_30rem] items-center gap-4 rounded-2xl bg-card px-6 py-5">
            {alarm?.value ? (
              <>
                <span className="flex size-14 flex-none items-center justify-center rounded-xl bg-op-fault/15 text-op-fault">
                  <OctagonAlert className="size-8" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-muted-foreground">Alarm on the station screen</div>
                  <div className="text-(length:--operator-text-lg) font-semibold">
                    {String(alarm.value)}
                  </div>
                  <OrderLine station={station} />
                  <RecipeLine station={station} />
                </div>
              </>
            ) : (
              <div className="min-w-0 space-y-1">
                <div className="text-muted-foreground">Order</div>
                {order ? (
                  <div className="flex flex-wrap items-baseline gap-x-4">
                    <span className="font-mono text-(length:--operator-text-lg) font-semibold">
                      {order.id}
                    </span>
                    <span>{order.materialText}</span>
                  </div>
                ) : (
                  <div className="text-(length:--operator-text-lg) font-semibold">
                    No active order
                  </div>
                )}
                <RecipeLine station={station} />
              </div>
            )}
          </div>
        </section>
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
            onSubmit={(value) =>
              void run(`attention:${correcting.id}`, () =>
                client.command(operations.readingConfirm, { attentionId: correcting.id, value }),
              ).then((ok) => ok && setCorrecting(undefined))
            }
          />
        </OperatorPanel>
      ) : classify ? (
        <OperatorPanel
          title="Why did it stop?"
          aside="Tap a reason or press its number. It goes to the MES."
        >
          {stop.sync === 'rejected' && stop.rejection && (
            <p className="font-semibold text-op-fault">
              The MES refused {stop.reason}: {stop.rejection.message}. Choose again.
            </p>
          )}
          <TilePicker
            label={`Why did the machine stop?${stop.alarm ? ` Alarm: ${stop.alarm}` : ''}`}
            tiles={(reasons.data?.items ?? []).map((reason) => ({
              value: reason.code,
              label: reason.text,
              detail: categoryWord[reason.category],
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
        </OperatorPanel>
      ) : (
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
              profile={devices.data?.scanners[0]}
              routes={devices.data?.routes.length ? devices.data.routes : defaultRoutes}
            />
          )}
        </>
      )}
      {desired && (
        <section
          aria-label="Requested recipe"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-6 py-4 text-(length:--operator-text)"
        >
          <span>
            Recipe <strong>{desired.recipe}</strong> for {desired.orderId}, requested by{' '}
            {desired.requestedBy}
          </span>
          <DeliveryBadge state={desired.sync} reason={desired.rejection} />
          {desired.holdReason && (
            <span className="font-medium text-op-attention-foreground">{desired.holdReason}</span>
          )}
        </section>
      )}
    </OperatorStation>
  );
}

const categoryWord: Record<string, string> = {
  planned: 'Planned',
  unplanned: 'Unplanned',
  quality: 'Quality',
};

/** "3 min", "1 h 12 min": how long a state has held. Re-renders twice a minute. */
function since(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The recipe the station screen shows, as last read; announced when it changes. */
function RecipeLine({ station }: { station: Station }) {
  return (
    <div role="status" className="text-[0.8em] text-muted-foreground">
      Recipe {shown(reading(station, 'recipe'))} on the station screen
    </div>
  );
}

function OrderLine({ station }: { station: Station }) {
  if (!station.order) return null;
  return (
    <div className="text-muted-foreground">
      {station.order.id} · {station.order.materialText} · {station.order.recipe}
    </div>
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
  const ready = usable(good) && usable(scrap);
  return (
    <OperatorPanel aria-label="Counters">
      <div className="grid gap-(--operator-gap) sm:grid-cols-2">
        {(
          [
            ['Good', good],
            ['Scrap', scrap],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className={cn(
              'rounded-xl bg-muted p-5',
              !usable(value) && 'bg-op-attention/15 ring-3 ring-op-attention ring-inset',
            )}
          >
            <div className="text-muted-foreground">{label}</div>
            <div className="font-mono text-[4.5rem] leading-none font-semibold tabular-nums">
              {shown(value)}
            </div>
            <div className="mt-1 text-[0.75em] text-muted-foreground">
              {value?.status === 'operator-verified' ? (
                <>Checked by {value.verifiedBy}</>
              ) : (
                <>
                  read from the screen{' '}
                  <Freshness
                    observedAt={value?.observedAt}
                    staleAfterMs={FRESH_MS}
                    confidence={value?.confidence}
                  />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {person && (
        <>
          <BigAction
            hold
            label="Hold to send counts to MES"
            disabled={!ready}
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
          {!ready && (
            <p className="text-center text-muted-foreground">
              Sending is held until both numbers are sure and fresh.
            </p>
          )}
        </>
      )}
    </OperatorPanel>
  );
}

/** The last stops, collapsed under the task so they never push it off screen. */
function RecentStops({ station }: { station: string }) {
  const stops = useQuery(live.liveQueryOptions(operations.stopList, { station, limit: 5 }));
  const items = stops.data?.items ?? [];
  const last = items[0];
  if (!last) return <span className="text-muted-foreground">No stops recorded</span>;
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-muted-foreground">
          Last stop{' '}
          {new Date(last.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
          · {last.reason ?? 'not classified'}
        </span>
        <span className="ml-auto rounded-lg bg-muted px-4 py-2 font-medium group-open:hidden">
          Recent stops ({items.length})
        </span>
        <span className="ml-auto hidden rounded-lg bg-muted px-4 py-2 font-medium group-open:inline">
          Hide stops
        </span>
      </summary>
      <section aria-label="Recent stops" className="mt-3">
        <ul className="divide-y rounded-xl border">
          {items.map((stop) => (
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
    </details>
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
