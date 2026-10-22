import { defineHostPlugin } from '@agent-native/host/plugin';
import { activityModule } from './contracts';
import { startCounting } from './counting';
import { activityPluginManifest } from './plugin-manifest';
import {
  activityHandlers,
  activityPolicy,
  createActivityState,
  type ActivityServices,
  type ActivityState,
} from './server';

const listOf = (setting: string | undefined) =>
  (setting ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * The activity plugin, written only against the public plugin API. Its slice holds command
 * counts per operation; a serving host runs the counting loop. `open` refuses a module in the
 * `activity-modules` setting that the application does not compose. It requires no other
 * plugin, because it reaches only the journal.
 */
export function createActivityPlugin(options: { intervalMs?: number } = {}) {
  return defineHostPlugin<ActivityState, ActivityServices>({
    manifest: activityPluginManifest,
    state: { create: createActivityState },
    handlers: activityHandlers,
    authorization: { resourceTypes: ['activity'], port: activityPolicy },
    async open({ manifest, settings }) {
      const composed = manifest.modules.filter((module) => module.id !== activityModule.id);
      const named = listOf(settings['activity-modules']);
      const unknown = named.filter((id) => !composed.some((module) => module.id === id));
      if (unknown.length)
        throw new Error(`activity-modules names unknown modules: ${unknown.join(', ')}`);
      const counted = named.length
        ? composed.filter((module) => named.includes(module.id))
        : composed;
      const modules = counted.map((module) => module.id);
      // Only commands are journaled; queries leave no entry to count.
      const operations = counted.flatMap((module) =>
        module.capabilities.filter((c) => c.kind === 'command').map((c) => c.id),
      );
      return {
        service: { modules },
        start: async (context) => [await startCounting(context, operations, options.intervalMs)],
        describe: () => ({ modules }),
      };
    },
  });
}

export const activityPlugin = createActivityPlugin();
