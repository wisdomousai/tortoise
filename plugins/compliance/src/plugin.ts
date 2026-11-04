import { auditServiceOf } from '@tortoise/audit/open';
import { defineHostPlugin } from '@tortoise/host/plugin';
import { siteServiceOf } from '@tortoise/site/open';
import { complianceCliCommand } from './cli';
import { createPostureMonitor } from './monitor';
import { compliancePluginManifest } from './plugin-manifest';
import {
  compliancePolicy,
  createComplianceHandlers,
  createComplianceState,
  type ComplianceServices,
  type ComplianceState,
} from './server';

/**
 * The compliance plugin. Its slice names who may read the audit trail (the local user at
 * creation); its queries read the site policy and the audit log through a posture monitor,
 * which a serving host re-checks on an interval. It adds `compliance report`.
 *
 * Each query needs `read` on `Audit` from this plugin's policy and is itself audited, because it
 * runs through the runtime like any other operation.
 */
export const compliancePlugin = defineHostPlugin<ComplianceState, ComplianceServices>({
  manifest: compliancePluginManifest,
  requires: ['site', 'audit'],
  state: { create: (localUserId) => createComplianceState([localUserId]) },
  handlers: createComplianceHandlers(),
  authorization: { resourceTypes: ['audit'], port: compliancePolicy },
  commands: [complianceCliCommand],
  async open({ services, build }) {
    const { policy } = siteServiceOf(services);
    const audit = auditServiceOf(services);
    const monitor = createPostureMonitor({
      policy,
      directory: audit.logDirectory,
      head: () => audit.head(),
      eventLog: audit.eventLog,
      forwarding: () => audit.forwarding(),
      attestation: async () => ({
        catalogDigest: audit.catalogDigest,
        executableDigest: await audit.executableDigest(),
      }),
      ...(build?.bestBefore ? { bestBefore: build.bestBefore } : {}),
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
