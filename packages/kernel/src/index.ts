/**
 * The portable host kernel: application and plugin composition, the kernel's ports and opening
 * an authority on a `HostPlatform`. It uses no Node, Bun or React Native API, so the Bun host and
 * the mobile host share it. Browser code imports only `manifest` and `plugin-manifest`.
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
export {
  defineManifest,
  targetPlatforms,
  type ApplicationManifest,
  type ApplicationTarget,
} from './manifest';
export {
  definePluginManifest,
  platformIds,
  type PlatformId,
  type PluginManifest,
  type PluginModules,
  type PluginSetting,
} from './plugin-manifest';
export {
  defineHostPlugin,
  type AnyHostPlugin,
  type CredentialSource,
  type HostPlugin,
  type HostPorts,
  type IdentityPort,
  type IngressPort,
  type NetworkPort,
  type PluginCommand,
  type PluginInstance,
  type PluginOpenContext,
  type PluginStartContext,
  type SettingsProviderContext,
} from './plugin';
export {
  assertPlatformSupports,
  type HostPlatform,
  type PlatformCapability,
  type PlatformOwnership,
} from './platform';
export { deploymentCatalog, deploymentComponents, deploymentRequirements } from './components';
export { combineIntegrations, type Integrations } from './integrations';
export { defaultPorts, isolatedNetwork, latePorts, noIngress, resolvePorts } from './plugins/ports';
export { assertClaimed, mergeSettings, settingsFor, type PluginSettings } from './plugins/settings';
export { openPlugins, type OpenedPlugins, type PluginPlatform } from './plugins/lifecycle';
export {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openAuthority,
  type Authority,
  type OpenAuthorityOptions,
} from './authority';
export { assertGlobals, installGlobals, missingGlobals, type RequiredGlobal } from './globals';
export { noShell, type ShellAdapter, type ShellPort } from './shell';
export { noFolders, type BoundFolder, type FolderPort } from './folders';
export {
  noProcesses,
  type ProcessAvailability,
  type ProcessPort,
  type ProcessSpawnOptions,
} from './processes';
export {
  checkMigrations,
  currentVersion,
  migrateSlice,
  type MigrationStep,
  type StateMigrations,
} from './migrations';
export { stateUpgrade } from './state-upgrade';
