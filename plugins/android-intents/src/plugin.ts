import { defineHostPlugin, type PluginOpenContext } from '@agent-native/kernel/plugin';
import { osServiceOf } from '@agent-native/os';
import { androidIntentsPluginManifest } from './plugin-manifest';

/**
 * Enable intent handlers and intent actions in the OS plugin. An intent is received through the
 * mobile shell, which submits it to the shell port like any OS request, so it only opens or
 * prefills; an intent action is built from its declaration and runs on an attached Android
 * adapter, which starts it in the declared package only.
 */
export async function openAndroidIntents(context: PluginOpenContext) {
  osServiceOf(context.services).enable({ handlers: ['intent'], actions: ['intent'] });
  return {};
}

/**
 * The Android intents plugin, on top of the OS plugin, which it requires. Without it, startup
 * refuses an application that declares an intent handler or action.
 */
export const androidIntentsPlugin = defineHostPlugin({
  manifest: androidIntentsPluginManifest,
  requires: ['os'],
  open: openAndroidIntents,
});

export default androidIntentsPlugin;
