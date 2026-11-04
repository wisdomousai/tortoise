/**
 * The generic local instance. It hosts exactly one application definition supplied by content
 * and owns the workspace, sessions, launch, HTTP/SSE, embedded MCP, the CLI and run supervision.
 * Server only: browser code imports `@tortoise/host/manifest` and nothing else from here.
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
export {
  defineFeature,
  mountFeature,
  type Feature,
  type FeatureAdoption,
  type FeatureMount,
  type MountBindings,
} from './feature';
export {
  definePluginManifest,
  type PluginManifest,
  type PluginModules,
  type PluginSetting,
} from './plugin-manifest';
export {
  defineHostPlugin,
  type AnyHostPlugin,
  type HostPlugin,
  type HostPorts,
  type IdentityPort,
  type IngressPort,
  type NetworkPort,
  type PluginCommand,
  type PluginInstance,
  type PluginOpenContext,
  type PluginStartContext,
} from './plugin';
export { readPluginSettings, type PluginSettings } from './plugins/settings';
export { defaultPorts } from './plugins/ports';
export { combineIntegrations, type Integrations } from './integrations';
export {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openEmbeddedInstance,
  workspaceStorage,
  type EmbeddedInstance,
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
