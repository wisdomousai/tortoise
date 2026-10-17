import {
  createObserver,
  gateReadings,
  StabilityGate,
  type ObservedReading,
  type ObserverOptions,
} from '@agent-native/observation';
import type { Extractor, ScreenTransport } from './ports';
import { createPerception } from './perceive';
import type { StationProfile } from './profile';

/**
 * One observation as submitted to the domain's ingest command. Only stable readings are
 * included; each is `observed` (confident enough to become fact) or `uncertain` (stable but below
 * the field's threshold: the domain asks a person instead of recording it).
 */
export interface Observation {
  readonly station: string;
  readonly profile: { readonly id: string; readonly version: string };
  readonly screen: string | null;
  readonly observedAt: number;
  readonly frameDigest: string;
  /** A person used the station's own input since the previous observation. */
  readonly localInput: boolean;
  /** Each carries the profile's declaration for its field, so a correction uses the right value type. */
  readonly readings: readonly ObservedReading<FieldDeclaration>[];
}

/** What a profile declares about a field's value: its type and, where given, options and format. */
export interface FieldDeclaration {
  readonly type: StationProfile['fields'][number]['type'];
  readonly options?: readonly string[];
  readonly decimals?: number;
  readonly unit?: string;
}

export interface StationObserverOptions extends Pick<
  ObserverOptions<Observation>,
  'application' | 'context' | 'ingestOperation' | 'toInput' | 'heartbeatMs'
> {
  readonly station: string;
  readonly profile: StationProfile;
  readonly transport: ScreenTransport;
  readonly extractors: readonly Extractor[];
}

/** The profile's declaration for a field, carried with each reading. */
const declarationOf = (field: StationProfile['fields'][number]): FieldDeclaration => ({
  type: field.type,
  ...(field.options ? { options: field.options } : {}),
  ...(field.decimals !== undefined ? { decimals: field.decimals } : {}),
  ...(field.unit ? { unit: field.unit } : {}),
});

/**
 * Watches a station screen and reports what it shows through the domain's ingest command, the
 * inbound half of the bridge. It never writes storage and never acts on the screen. A reading
 * must agree over `stableReads` consecutive captures before it is submitted, which filters
 * redraw flicker and one-off misreads. Heartbeat and idempotency keys follow `createObserver`;
 * the station names the source in its keys.
 */
export function createStationObserver(options: StationObserverOptions) {
  const perception = createPerception(options.profile, options.extractors);
  const gate = new StabilityGate();
  const fieldOf = (id: string) => {
    const field = perception.field(id);
    return field && { ...field, declared: declarationOf(field) };
  };
  let lastObservedAt: number | undefined;

  async function sample(signal: AbortSignal): Promise<Observation> {
    const frame = await options.transport.capture(signal);
    const view = await perception.view(frame, signal);
    const localInput =
      lastObservedAt !== undefined && options.transport.localInputSince
        ? await options.transport.localInputSince(lastObservedAt, signal)
        : false;
    lastObservedAt = frame.capturedAt;
    return {
      station: options.station,
      profile: { id: options.profile.id, version: options.profile.version },
      screen: view.screen ?? null,
      observedAt: frame.capturedAt,
      frameDigest: frame.digest,
      localInput,
      readings: gateReadings(gate, view.readings.values(), fieldOf),
    };
  }

  return createObserver<Observation>({ ...options, source: options.station, sample });
}
