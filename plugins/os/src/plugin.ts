import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { openOs } from './open';
import { osPluginManifest } from './plugin-manifest';

/**
 * The OS plugin. It provides the shell port: requests the OS delivers under the application's
 * declared handlers become deliveries for the session that submitted them, and declared actions
 * run through the adapter attached for the caller. It serves link and file handlers and open,
 * reveal and open-file actions; capability plugins that require it serve the other kinds.
 */
export function createOsPlugin(options: { now?: () => number } = {}) {
  return defineHostPlugin({ manifest: osPluginManifest, open: openOs(options) });
}

export const osPlugin = createOsPlugin();
