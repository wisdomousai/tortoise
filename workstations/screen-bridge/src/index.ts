/**
 * Server-only bridge to legacy station software through its screen. Observations enter the
 * application through a domain ingest command (`createStationObserver`); actions leave through
 * the outbox as a system-of-record connector (`createStationConnector`). Nothing here writes
 * application state directly. See docs/operator-workstations.md.
 */
export * from './ports';
export {
  allowedKeys,
  center,
  contains,
  findNode,
  intersects,
  parseProfile,
  resolveBinding,
  stationProfileSchema,
  validateProfile,
  type Condition,
  type Procedure,
  type ProcedureStep,
  type ProfileField,
  type StationProfile,
} from './profile';
export {
  Debouncer,
  createRecognizer,
  evaluate,
  valueMatches,
  type Recognizer,
  type Reading,
  type View,
} from './recognize';
export { createStationObserver, type Observation, type StationObserverOptions } from './observer';
export {
  createStationConnector,
  type BridgeControl,
  type StationConnectorOptions,
} from './controller';
export { createScriptedDriver } from './scripted-driver';
export { runGolden, type GoldenFieldReport, type GoldenFrame, type GoldenReport } from './golden';
export { createAccessibilityExtractor, parseDisplayed } from './recognition/accessibility';
export { createFixtureExtractor } from './recognition/fixture';
export {
  createWorkerExtractor,
  type WorkerExtractorOptions,
  type WorkerProcess,
} from './recognition/worker';
export {
  createOpenAiCompatibleVisionExtractor,
  visionEndpoint,
  type VisionExtractorOptions,
} from './recognition/openai-compatible-vision';
export {
  createPlaywrightTransport,
  toAccessibility,
  type PlaywrightPageLike,
  type PlaywrightTransportOptions,
} from './transports/playwright';
