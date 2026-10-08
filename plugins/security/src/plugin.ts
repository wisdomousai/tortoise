import { defineHostPlugin } from '@agent-native/host/plugin';
import { openSecurity } from './open';
import { securityPluginManifest } from './plugin-manifest';

/**
 * The security plugin. It provides the kernel's event-log, network and identity ports, and the
 * ingress port when the site policy selects mutual TLS. An application without it runs with
 * the kernel defaults: no network, no audit log, loopback only.
 */
export const securityPlugin = defineHostPlugin({
  manifest: securityPluginManifest,
  open: openSecurity,
});
