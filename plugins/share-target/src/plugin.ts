import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { openShareTarget } from './open';
import { shareTargetPluginManifest } from './plugin-manifest';

/**
 * The share target plugin. It serves the application's share handlers (content another app
 * shares to it) and share actions (the system share sheet), on top of the OS plugin, which it
 * requires. A share only opens or prefills, like any unsolicited OS request.
 */
export function createShareTargetPlugin(options: { now?: () => number } = {}) {
  return defineHostPlugin({
    manifest: shareTargetPluginManifest,
    requires: ['os'],
    open: openShareTarget(options),
  });
}

export const shareTargetPlugin = createShareTargetPlugin();
