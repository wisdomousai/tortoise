import { defineHostPlugin } from '@tortoise/host/plugin';
import { openProcesses } from './open';
import { processPluginManifest } from './plugin-manifest';

/**
 * The process plugin. It provides the process port: declared child processes start from the
 * executable the site policy binds, with an environment built from nothing. Without it the kernel
 * starts no process.
 */
export const processPlugin = defineHostPlugin({
  manifest: processPluginManifest,
  requires: ['site'],
  open: openProcesses,
});

export default processPlugin;
