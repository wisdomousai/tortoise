import { defineHostPlugin } from '@agent-native/host/plugin';
import { networkCliCommand } from './cli';
import { openNetwork } from './open';
import { networkPluginManifest } from './plugin-manifest';

/**
 * The network plugin. It provides the network port (the egress guard and, in a serving host,
 * the child proxy) and, under a policy that selects mutual TLS, the ingress port. It adds
 * `network export`. Without it the kernel reaches nothing and listens on loopback.
 */
export const networkPlugin = defineHostPlugin({
  manifest: networkPluginManifest,
  requires: ['site'],
  commands: [networkCliCommand],
  open: openNetwork,
});
