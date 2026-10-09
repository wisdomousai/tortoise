import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * The browser-safe part of the site plugin: the `site-policy` launcher setting. It adds no
 * module and no destination; the policy only binds what other parts declare.
 */
export const sitePluginManifest = definePluginManifest({
  id: 'site',
  title: 'Site policy',
  settings: [
    {
      key: 'site-policy',
      env: 'AGENT_NATIVE_SITE_POLICY',
      kind: 'path',
      description: 'bind declared destinations; absent: isolated',
    },
  ],
});
