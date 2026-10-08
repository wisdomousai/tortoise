import { defineHostPlugin } from '@agent-native/host/plugin';
import { securityServiceOf } from '@agent-native/security/open';
import { assuranceCliCommand } from './cli';
import { createPostureMonitor } from './monitor';
import { assurancePluginManifest } from './plugin-manifest';
import {
  assurancePolicy,
  createAssuranceHandlers,
  createAssuranceState,
  type AssuranceServices,
  type AssuranceState,
} from './server';

/**
 * The assurance plugin. Its slice names who may read the audit trail (the workspace owner at
 * creation); its queries read the security plugin's log and policy through a posture monitor,
 * which a serving host re-checks on an interval. It adds the `security` and `audit` CLI verbs.
 *
 * Each query needs `read` on `Audit` from this plugin's policy and is itself audited, because it
 * runs through the runtime like any other operation.
 */
export const assurancePlugin = defineHostPlugin<AssuranceState, AssuranceServices>({
  manifest: assurancePluginManifest,
  requires: ['security'],
  state: { create: (ownerId) => createAssuranceState([ownerId]) },
  handlers: createAssuranceHandlers(),
  authorization: { resourceTypes: ['audit'], port: assurancePolicy },
  commands: [assuranceCliCommand],
  async open({ services }) {
    const security = securityServiceOf(services);
    const monitor = createPostureMonitor({
      policy: security.policy,
      directory: security.logDirectory,
      head: () => security.head(),
      eventLog: security.eventLog,
      forwarding: () => security.forwarding(),
      attestation: async () => ({
        catalogDigest: security.catalogDigest,
        executableDigest: await security.executableDigest(),
      }),
    });
    return {
      service: monitor,
      // Serving hosts only; one-shot and stdio processes check posture on demand.
      async start() {
        monitor.start();
        return [{ stop: () => monitor.stop() }];
      },
      close: () => monitor.stop(),
    };
  },
});
