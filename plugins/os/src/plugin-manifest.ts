import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';

/**
 * The browser-safe part of the OS plugin: its launcher settings. It adds no module; the handlers
 * and actions it serves are declared by the application's modules and components.
 */
export const osPluginManifest = definePluginManifest({
  id: 'os',
  title: 'OS integration',
  // Portable: the desktop and web adapters reach it over HTTP, the mobile one in-process.
  platforms: ['bun', 'android', 'ios'],
  settings: [
    {
      key: 'os-scheme',
      env: 'AGENT_NATIVE_OS_SCHEME',
      kind: 'string',
      description: 'URL scheme the application handles, from its identity; absent: no scheme links',
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
