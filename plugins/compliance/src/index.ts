/**
 * Compliance evidence for a composed deployment. Server-only (reads files, hashes, parses the
 * lockfile); the capability module alone is browser-safe at `@tortoise/compliance/contracts`.
 *
 * - `securityManifest`, `dataFlowsMarkdown`: what the deployment may touch, from declarations.
 * - `controls`, `controlsMarkdown`: control catalog mapped to ISO 27001, NIST 800-53/CSF and
 *   IEC 62443-4-2, with re-runnable evidence.
 * - `cycloneDx`: CycloneDX 1.6 SBOM from `bun.lock`, with declared destinations as services.
 * - `assessPosture`, `createPostureMonitor`: passive runtime posture and `posture.checked`.
 * - `compliancePlugin`: the host plugin composing the auditor queries, the monitor and the CLI
 *   verb; its manifest (`./plugin-manifest`) and screens (`./plugin-screens`) are browser-safe.
 */
export {
  securityManifest,
  dataFlowsMarkdown,
  type DataFlow,
  type SecurityManifest,
} from './manifest';
export { osManifest, osTables, type OsManifest } from './os-manifest';
export { controls, controlsMarkdown, type Control } from './controls';
export { cycloneDx, parseBunLock, type SbomOptions } from './sbom';
export {
  accumulateEgress,
  assessPosture,
  postureMarkdown,
  type EgressUsage,
  type PostureInput,
} from './posture';
export {
  createPostureMonitor,
  type CompliancePort,
  type PostureMonitor,
  type PostureMonitorOptions,
} from './monitor';
export {
  complianceModule,
  complianceOperations,
  type AuditEventView,
  type DestinationPosture,
  type LogVerification,
  type Posture,
  type PostureCheck,
} from './contracts';
export { compliancePlugin } from './plugin';
export { compliancePluginManifest } from './plugin-manifest';
export { complianceCliCommand, complianceCommand, complianceUsage } from './cli';
