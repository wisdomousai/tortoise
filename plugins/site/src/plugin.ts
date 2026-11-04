import { defineHostPlugin } from '@tortoise/host/plugin';
import { siteCliCommand } from './cli';
import { openSite } from './open';
import { sitePluginManifest } from './plugin-manifest';

/**
 * The site plugin. It resolves the site policy, refuses one below its profile floor, provides
 * the identity port and adds `site check`. Compose it first: the network, audit and compliance
 * plugins require it. An application without it runs with the kernel defaults.
 */
export const sitePlugin = defineHostPlugin({
  manifest: sitePluginManifest,
  commands: [siteCliCommand],
  open: openSite,
});
