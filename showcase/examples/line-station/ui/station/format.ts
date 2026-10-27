import type { OutputOf } from '@agent-native/contracts';
import type { ScanRoute } from '@agent-native/devices';
import type { StationSignal } from '@/components/status-strip';
import { operations } from '../../contracts';

export type Station = OutputOf<typeof operations.stationGet>;
export type Reading = Station['readings'][string];
export type Attention = OutputOf<typeof operations.attentionList>['items'][number];

/** Matches the domain's freshness window: older observations are shown as stale. */
export const FRESH_MS = 30_000;
/** Used until a supervisor saves site routes in device configuration. */
export const defaultRoutes: readonly ScanRoute[] = [
  { intent: 'order', pattern: '^(ORD-\\d{4,})$' },
];

export const machineSignal = (value: unknown): StationSignal =>
  value === 'RUNNING'
    ? 'ok'
    : value === 'ALARM'
      ? 'fault'
      : value === 'STOPPED'
        ? 'attention'
        : 'idle';
export const reading = (station: Station, field: string): Reading | undefined =>
  station.readings[field];
export const shown = (value: Reading | undefined) =>
  value === undefined || value.value === null ? '—' : String(value.value);
export const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Request failed';

/** What a station card and the banner say about the machine. */
export const machineWord = (machine: string | undefined, stale: boolean) =>
  stale ? 'Not seen' : (machine ?? 'Unknown').toLowerCase();
export const cardTone = (machine: string | undefined, stale: boolean) =>
  stale
    ? 'bg-op-idle text-op-idle-foreground'
    : machine === 'RUNNING'
      ? 'bg-op-ok text-op-ok-foreground'
      : machine === 'ALARM'
        ? 'bg-op-fault text-op-fault-foreground'
        : machine === 'STOPPED'
          ? 'bg-op-attention text-op-attention-foreground'
          : 'bg-op-idle text-op-idle-foreground';
export const modeWord: Record<Station['mode'], string> = {
  'monitor-only': 'Watching only',
  assist: 'Assists',
  actuate: 'Loads recipes',
};

export const categoryWord: Record<string, string> = {
  planned: 'Planned',
  unplanned: 'Unplanned',
  quality: 'Quality',
};

/** "3 min", "1 h 12 min": how long a state has held. Re-renders twice a minute. */
export function since(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
