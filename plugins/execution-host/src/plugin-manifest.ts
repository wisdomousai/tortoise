import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * The browser-safe part of the execution host plugin. It declares nothing of its own: each
 * sandbox an application uses is an `executionSandbox` component in its manifest.
 */
export const executionHostPluginManifest = definePluginManifest({
  id: 'execution-host',
  title: 'Execution host',
});

export default executionHostPluginManifest;
