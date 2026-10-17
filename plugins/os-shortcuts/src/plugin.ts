import { defineHostPlugin, type PluginOpenContext } from '@agent-native/kernel/plugin';
import { osServiceOf } from '@agent-native/os';
import { osShortcutsPluginManifest } from './plugin-manifest';

/**
 * Enable shortcut handlers in the OS plugin. A launcher entry opens the application with its
 * shortcut link (`<scheme>:///?os-shortcut=<id>`, or `/?os-shortcut=<id>` on the web), which
 * the shell submits like any link and the shell port reads as that shortcut. Anyone can send
 * that link, so a shortcut only opens or prefills, like any unsolicited OS request.
 */
export async function openOsShortcuts(context: PluginOpenContext) {
  osServiceOf(context.services).enable({ handlers: ['shortcut'] });
  return {};
}

/**
 * The OS shortcuts plugin, on top of the OS plugin, which it requires. Without it, startup
 * refuses an application that declares a shortcut handler.
 */
export const osShortcutsPlugin = defineHostPlugin({
  manifest: osShortcutsPluginManifest,
  requires: ['os'],
  open: openOsShortcuts,
});

export default osShortcutsPlugin;
