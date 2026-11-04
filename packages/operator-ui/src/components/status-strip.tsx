import * as React from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Clock3,
  OctagonX,
  PauseCircle,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Station signals. Each one has an icon and a word as well as a color, so none relies on hue. */
export type StationSignal = 'ok' | 'pending' | 'attention' | 'fault' | 'idle';

const signalIcon: Record<StationSignal, React.ComponentType<{ className?: string }>> = {
  ok: CircleCheck,
  pending: Clock3,
  attention: CircleHelp,
  fault: OctagonX,
  idle: CircleDashed,
};
const signalClass: Record<StationSignal, string> = {
  ok: 'border-op-ok bg-op-ok text-op-ok-foreground',
  pending: 'border-op-pending bg-op-pending text-op-pending-foreground',
  attention: 'border-op-attention bg-op-attention text-op-attention-foreground',
  fault: 'border-op-fault bg-op-fault text-op-fault-foreground',
  idle: 'border-border bg-op-idle text-op-idle-foreground',
};

/** A row of station signals, readable from one to two meters. Announces changes politely. */
function StatusStrip({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="status-strip"
      role="status"
      aria-live="polite"
      className={cn('flex flex-wrap items-stretch gap-(--operator-gap)', className)}
      {...props}
    />
  );
}

/** One station signal: machine state, bridge mode, who has control, system of record sync. */
function StatusPill({
  signal,
  label,
  detail,
  icon,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  signal: StationSignal;
  label: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const Icon = signalIcon[signal];
  return (
    <div
      data-slot="status-pill"
      data-signal={signal}
      className={cn(
        'flex min-h-(--operator-target) items-center gap-3 rounded-xl border-2 px-4 py-2 text-(length:--operator-text)',
        signalClass[signal],
        className,
      )}
      {...props}
    >
      {icon ?? <Icon className="size-7 shrink-0" aria-hidden />}
      <span className="flex flex-col leading-tight">
        <span className="font-semibold">{label}</span>
        {detail && <span className="text-[0.75em] opacity-90">{detail}</span>}
      </span>
    </div>
  );
}

/**
 * The one signal that matters most on a station, readable from the machine: a large word on a
 * signal color, with how long it has held and how fresh the reading is. Announced politely.
 */
function SignalBanner({
  signal,
  label,
  detail,
  icon,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  signal: StationSignal;
  label: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const Icon = signalIcon[signal];
  return (
    <div
      data-slot="signal-banner"
      data-signal={signal}
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-5 rounded-2xl border-2 px-6 py-5',
        signalClass[signal],
        className,
      )}
      {...props}
    >
      {icon ?? <Icon className="size-12 shrink-0" aria-hidden />}
      <div className="min-w-0">
        <div className="text-(length:--operator-text-xl) leading-none font-bold tracking-wide uppercase">
          {label}
        </div>
        {detail && <div className="mt-1.5 text-(length:--operator-text) opacity-90">{detail}</div>}
      </div>
    </div>
  );
}

/** Outbox state of one local write, as reported by the owning feature. */
export type DeliveryState = 'pending' | 'retrying' | 'held' | 'accepted' | 'rejected';

const deliveryLook: Record<
  DeliveryState,
  { icon: React.ComponentType<{ className?: string }>; word: string; className: string }
> = {
  pending: { icon: Clock3, word: 'Pending', className: 'border-op-pending/60 text-op-pending' },
  retrying: {
    icon: RefreshCw,
    word: 'Retrying',
    className: 'border-op-pending/60 text-op-pending',
  },
  held: {
    icon: PauseCircle,
    word: 'Needs check',
    className: 'border-op-attention bg-op-attention/20 text-foreground',
  },
  accepted: { icon: CircleCheck, word: 'Accepted', className: 'border-op-ok/60 text-op-ok' },
  rejected: {
    icon: CircleAlert,
    word: 'Rejected',
    className: 'border-op-fault/60 bg-op-fault/10 text-op-fault',
  },
};

/**
 * Where a local write stands with the system that owns it. A commit command result proves the local
 * write only; this badge shows the outbox state: waiting, retrying, held for reconciliation
 * (the result of a screen action could not be confirmed), accepted with the system of record's reference,
 * or rejected with its reason.
 */
function DeliveryBadge({
  state,
  reference,
  reason,
  className,
}: {
  state: DeliveryState;
  /** The system of record's reference once accepted. */
  reference?: string;
  /** Rejection or hold reason. */
  reason?: { code: string; message: string };
  className?: string;
}) {
  const look = deliveryLook[state];
  const Icon = look.icon;
  const text =
    state === 'accepted'
      ? (reference ?? look.word)
      : state === 'rejected'
        ? (reason?.code ?? look.word)
        : look.word;
  return (
    <Badge
      variant="outline"
      data-slot="delivery-badge"
      data-state={state}
      title={reason?.message ?? reference}
      className={cn(
        'h-auto gap-1.5 px-2.5 py-1 text-[0.8em] [&>svg]:size-4!',
        look.className,
        className,
      )}
    >
      <Icon aria-hidden />
      {text}
    </Badge>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function age(ms: number) {
  if (ms < 5_000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return `${Math.round(ms / 3_600_000)} h ago`;
}

/**
 * How old an observed value is and how sure the reading was. Observed values come from the
 * station screen, so a value is stale once the observer stops reporting; the stale state is
 * shown in words, not only by dimming.
 */
function Freshness({
  observedAt,
  staleAfterMs = 30_000,
  confidence,
  now: fixedNow,
  className,
}: {
  observedAt: string | number | Date | undefined;
  staleAfterMs?: number;
  /** 0–1; shown when below 1 so operators know a value was read from pixels. */
  confidence?: number;
  /** Fixed clock for tests and screenshots. */
  now?: number;
  className?: string;
}) {
  const ticking = useNow(1000);
  const now = fixedNow ?? ticking;
  if (observedAt === undefined)
    return (
      <span data-slot="freshness" data-stale className={cn('text-op-fault', className)}>
        Not observed
      </span>
    );
  const elapsed = Math.max(0, now - new Date(observedAt).getTime());
  const stale = elapsed > staleAfterMs;
  return (
    <span
      data-slot="freshness"
      data-stale={stale || undefined}
      // Inherits its color so it reads on any surface, including a colored status pill; the stale
      // state is carried by the word and weight, and callers may add a color.
      className={cn('tabular-nums', stale ? 'font-semibold' : 'opacity-80', className)}
    >
      {stale ? `Stale · ${age(elapsed)}` : age(elapsed)}
      {confidence !== undefined && confidence < 1 && ` · ${Math.round(confidence * 100)} % sure`}
    </span>
  );
}

export { StatusStrip, StatusPill, SignalBanner, DeliveryBadge, Freshness };
