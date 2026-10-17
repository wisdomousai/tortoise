/**
 * Server-only bridge to legacy station software through its screen. Observations enter the
 * application through a domain ingest command (`createStationObserver`); actions leave through
 * the outbox as a system-of-record connector (`createStationConnector`). Nothing here writes
 * application state directly. See docs/operator-workstation-pattern.md.
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
  StabilityGate,
  createPerception,
  evaluate,
  valueMatches,
  type Perception,
  type Reading,
  type View,
} from './perceive';
export { createStationObserver, type Observation, type StationObserverOptions } from './observer';
export {
  createStationConnector,
  type BridgeControl,
  type StationConnectorOptions,
} from './controller';
export { createScriptedDriver } from './scripted-driver';
export { runGolden, type GoldenFieldReport, type GoldenFrame, type GoldenReport } from './golden';
export { createAccessibilityExtractor, parseDisplayed } from './perception/accessibility';
export { createFixtureExtractor } from './perception/fixture';
export {
  createWorkerExtractor,
  type WorkerExtractorOptions,
  type WorkerProcess,
} from './perception/worker';
export {
  createOpenAiCompatibleVisionExtractor,
  visionEndpoint,
  type VisionExtractorOptions,
} from './perception/openai-compatible-vision';
export {
  createPlaywrightTransport,
  toAccessibility,
  type PlaywrightPageLike,
  type PlaywrightTransportOptions,
} from './transports/playwright';
