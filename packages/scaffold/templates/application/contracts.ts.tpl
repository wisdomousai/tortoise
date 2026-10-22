import { defineModule } from '@agent-native/contracts';
// scaffold:imports

/** Every operation of the {{displayName}} module, by key. Browser-safe. */
export const operations = {
  // scaffold:operations
} as const;

export const {{app.camel}}Module = defineModule({
  id: '{{app.kebab}}',
  capabilities: Object.values(operations),
  requires: [
    // scaffold:requires
  ],
  agents: [
    // scaffold:agents
  ],
  requirements: {
    network: [
      // scaffold:network
    ],
  },
});
