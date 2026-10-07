/**
 * Line stations on top of a homebrew MES and screen-only station software.
 *
 * Ownership: the MES owns orders and stop reasons (synced in). The station software owns actual
 * machine state, the loaded recipe and counters; this application only observes them, with
 * provenance, through the station bridge. This application owns what happens at the station:
 * stops and their classification, count confirmations, operator verifications, the desired
 * recipe, the bridge mode and the seat. Forwarded records reach the MES through the outbox;
 * desired station state reaches the station software through the outbox and its screen.
 */
export type StationRole = 'operator' | 'supervisor' | 'viewer';
export type BridgeMode = 'monitor-only' | 'assist' | 'actuate';
export type Seat = 'operator' | 'agent' | 'idle';
export type SyncStatus = 'pending' | 'accepted' | 'rejected';
export type FieldValue = string | number | boolean | null;

/** Station fields the domain interprets; other profile fields are kept as readings only. */
export const FIELDS = {
  machine: 'machine',
  alarm: 'alarm',
  recipe: 'recipe',
  good: 'good',
  scrap: 'scrap',
} as const;
/** An observation older than this no longer describes the station. */
export const FRESH_MS = 30_000;
export const MES = 'mes';
export const hmiTarget = (station: string) => `legacy-hmi:${station}`;
export const bridgePrincipal = (station: string) => `station-bridge:${station}`;

export interface Synchronized {
  effectId: string;
  sync: SyncStatus;
  sorRef?: string;
  rejection?: { code: string; message: string };
}
export interface Reading {
  value: FieldValue;
  confidence: number;
  source: string;
  model?: { id: string; version?: string; digest?: string };
  observedAt: number;
  status: 'observed' | 'operator-verified';
  verifiedBy?: string;
}
export interface Station {
  id: string;
  name: string;
  line: string;
  members: Record<string, StationRole>;
  /** The only principal that may report observations and settle screen procedures here. */
  bridgePrincipalId: string;
  mode: BridgeMode;
  seat: Seat;
  seatChangedBy?: string;
  seatChangedAt?: number;
  screen?: string | null;
  observedAt?: number;
  profile?: { id: string; version: string };
  localInputAt?: number;
  readings: Record<string, Reading>;
  orderId?: string;
  desired?: {
    recipe: string;
    orderId: string;
    requestedBy: string;
    requestedAt: number;
  } & Synchronized;
}
export interface Order {
  id: string;
  station: string;
  material: string;
  materialText: string;
  recipe: string;
  quantity: number;
  status: 'released' | 'active' | 'completed';
}
export interface Reason {
  code: string;
  text: string;
  category: 'planned' | 'unplanned' | 'quality';
}
export interface Stop extends Partial<Synchronized> {
  id: string;
  station: string;
  orderId?: string;
  state: 'STOPPED' | 'ALARM';
  alarm?: string;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  classifiedBy?: string;
  classifiedAt?: number;
}
export interface CountReport extends Synchronized {
  id: string;
  station: string;
  orderId: string;
  good: number;
  scrap: number;
  observedAt: number;
  provenance: 'observed' | 'operator-verified';
  confirmedBy: string;
  confirmedAt: number;
}
/** A reading the bridge saw but could not read with confidence. One open item per field. */
export interface AttentionItem {
  id: string;
  station: string;
  field: string;
  proposed: FieldValue;
  confidence: number;
  source: string;
  model?: Reading['model'];
  observedAt: number;
  createdAt: number;
  /** Kept after resolution, so who confirmed what remains auditable. */
  resolvedAt?: number;
  resolvedBy?: string;
  resolution?: 'confirmed' | 'superseded';
}
export interface LineState {
  mesPrincipalId: string;
  stations: Record<string, Station>;
  orders: Record<string, Order>;
  reasons: Record<string, Reason>;
  stops: Record<string, Stop>;
  counts: Record<string, CountReport>;
  attention: Record<string, AttentionItem>;
  watermark?: string;
  lastSyncAt?: number;
}

export function createLineState(
  options: {
    mesPrincipalId?: string;
    stations?: { id: string; name: string; line: string; members: Record<string, StationRole> }[];
  } = {},
): LineState {
  const stations: LineState['stations'] = {};
  for (const station of options.stations ?? [
    { id: 'line-1', name: 'Filler 1', line: 'Line 1', members: { owner: 'supervisor' } },
  ])
    put(stations, station.id, {
      ...station,
      members: { ...station.members },
      bridgePrincipalId: bridgePrincipal(station.id),
      // Observation is the safe default; actuation is switched on per station by a supervisor.
      mode: 'monitor-only',
      seat: 'idle',
      readings: {},
    });
  return {
    mesPrincipalId: options.mesPrincipalId ?? 'mes-integration',
    stations,
    orders: {},
    reasons: {},
    stops: {},
    counts: {},
    attention: {},
  };
}

/** Dictionary keys are untrusted input; inherited properties are never domain records. */
export function own<T>(records: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(records, id) ? records[id] : undefined;
}
export function put<T>(records: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(records, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export function stationRole(state: LineState, principalId: string, station: string) {
  const entry = own(state.stations, station);
  return entry ? own(entry.members, principalId) : undefined;
}
/** The station a bridge principal serves, if it is one. */
export function bridgeStation(state: LineState, principalId: string): Station | undefined {
  return Object.values(state.stations).find((station) => station.bridgePrincipalId === principalId);
}
/** The open attention item for a station field, if any. */
export function openAttention(state: LineState, station: string, field?: string): AttentionItem[] {
  return Object.values(state.attention).filter(
    (item) =>
      item.station === station &&
      item.resolvedAt === undefined &&
      (field === undefined || item.field === field),
  );
}
export function openStop(state: LineState, station: string): Stop | undefined {
  return Object.values(state.stops).find(
    (stop) => stop.station === station && stop.endedAt === undefined,
  );
}
/** A reading that may be used as fact: confident or confirmed by a person, and fresh. */
export function usable(reading: Reading | undefined, now: number): reading is Reading {
  return reading !== undefined && reading.value !== null && now - reading.observedAt <= FRESH_MS;
}
