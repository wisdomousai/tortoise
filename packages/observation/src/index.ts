/**
 * Server-only observation of sources that cannot be queried: readings with provenance, stability
 * across consecutive reads, confidence thresholds and submission through a domain ingest command.
 * `@agent-native/screen-bridge` builds the screen observer on it; a driver connector builds the
 * instrument observer on it.
 */
export {
  clampConfidence,
  type DeviceIdentity,
  type Extractor,
  type FieldValue,
  type ModelIdentity,
  type RawReading,
  type Reading,
} from './readings';
export { StabilityGate, gateReadings, type GatedField, type ObservedReading } from './stability';
export {
  createObserver,
  type ObservationBase,
  type Observer,
  type ObserverOptions,
} from './observer';
