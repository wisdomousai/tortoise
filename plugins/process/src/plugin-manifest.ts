import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/**
 * The browser-safe part of the process plugin. It declares nothing of its own: it starts what
 * the application and the other plugins declare, from the executables the site policy binds.
 */
export const processPluginManifest = definePluginManifest({
  id: 'process',
  title: 'Processes',
});

export default processPluginManifest;
