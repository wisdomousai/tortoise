import { definePluginManifest } from '@tortoise/host/plugin-manifest';

/**
 * The browser-safe part of the model server plugin. It declares nothing of its own: the server
 * is a `modelServer` component, and the address it listens on is the `local-inference`
 * destination of `localInferenceComponent` (`@tortoise/agents/requirements`).
 */
export const modelServerPluginManifest = definePluginManifest({
  id: 'model-server',
  title: 'Model server',
});

export default modelServerPluginManifest;
