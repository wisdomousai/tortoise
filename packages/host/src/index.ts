/**
 * The generic local authority. It hosts exactly one application definition supplied by content
 * and owns the workspace, sessions, launch, HTTP/SSE, embedded MCP, the CLI and run supervision.
 * Server only: browser code imports `@agent-native/host/manifest` and nothing else from here.
 */
export {
  createApplicationRuntime,
  defineApplication,
  hostContext,
  type AnyApplicationDefinition,
  type ApplicationConnections,
  type ApplicationDefinition,
  type ConnectContext,
  type HostedApplication,
  type Observer,
} from './application';
export { defineManifest, type ApplicationManifest } from './manifest';
export { combineIntegrations, type Integrations } from './integrations';
export {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openEmbeddedAuthority,
  workspaceStorage,
  type EmbeddedAuthority,
} from './embedded';
export { startHost } from './host';
export { serve } from './serve';
export { createCli } from './cli';
export {
  applicationEntry,
  loadApplication,
  loadManifest,
  readApplicationIdentity,
  readStarterConfig,
  type ApplicationIdentity,
  type StarterConfig,
} from './config';
