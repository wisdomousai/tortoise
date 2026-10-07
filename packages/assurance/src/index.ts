/**
 * Security assurance for a composed deployment. Server-only (reads files, hashes, parses the
 * lockfile); the capability module alone is browser-safe at `@agent-native/assurance/contracts`.
 *
 * - `securityManifest`, `dataFlowsMarkdown`: what the deployment may touch, from declarations.
 * - `controls`, `controlsMarkdown`: control catalog mapped to ISO 27001, NIST 800-53/CSF and
 *   IEC 62443-4-2, with re-runnable evidence.
 * - `cycloneDx`: CycloneDX 1.6 SBOM from `bun.lock`, with declared destinations as services.
 * - `networkRules`, `exportRules`: OS and orchestrator rules from a resolved site policy.
 * - `assessPosture`, `createPostureMonitor`: passive runtime posture and `posture.checked`.
 */
export {
  securityManifest,
  dataFlowsMarkdown,
  type DataFlow,
  type SecurityManifest,
} from './manifest';
export { controls, controlsMarkdown, type Control } from './controls';
export { cycloneDx, parseBunLock, type SbomOptions } from './sbom';
export {
  networkRules,
  type AllowRule,
  type RuleOptions,
  type RuleSet,
  type UnresolvedRule,
} from './rules';
export { exportFormats, exportRules, type ExportFormat, type ExportOptions } from './exporters';
export {
  accumulateEgress,
  assessPosture,
  postureMarkdown,
  type EgressUsage,
  type PostureInput,
} from './posture';
export {
  createPostureMonitor,
  type AssurancePort,
  type PostureMonitor,
  type PostureMonitorOptions,
} from './monitor';
export {
  assuranceModule,
  assuranceOperations,
  type AuditEventView,
  type DestinationPosture,
  type LogVerification,
  type Posture,
  type PostureCheck,
} from './contracts';
