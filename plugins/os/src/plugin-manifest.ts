import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * The browser-safe part of the OS plugin: its launcher settings. It adds no module; the handlers
 * and actions it serves are declared by the application's modules and components.
 */
export const osPluginManifest = definePluginManifest({
  id: 'os',
  title: 'OS integration',
  settings: [
    {
      key: 'os-scheme',
      env: 'AGENT_NATIVE_OS_SCHEME',
      kind: 'string',
      description: 'URL scheme the application answers, from its identity; absent: no scheme links',
    },
    {
      key: 'os-link-hosts',
      env: 'AGENT_NATIVE_OS_LINK_HOSTS',
      kind: 'string',
      description: 'comma-separated hosts whose https links verified link handlers accept',
    },
    {
      key: 'os-disabled',
      env: 'AGENT_NATIVE_OS_DISABLED',
      kind: 'string',
      description: 'comma-separated OS handler and action ids the site turns off',
    },
  ],
});
