import { defineHostPlugin } from '@tortoise/host/plugin';
import { deploymentCliCommand } from './cli';
import { openDeployment } from './open';
import { deploymentPluginManifest } from './plugin-manifest';

/**
 * The deployment plugin. It resolves the deployment policy, refuses one below its profile floor, provides
 * the identity port and adds `policy check`. Compose it first: the network, audit and compliance
 * plugins require it. An application without it runs with the kernel defaults.
 */
export const deploymentPlugin = defineHostPlugin({
  manifest: deploymentPluginManifest,
  commands: [deploymentCliCommand],
  open: openDeployment,
});
