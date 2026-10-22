import { drainTargets, type TargetIntegration } from '@agent-native/integration';
import { hostContext, type ApplicationConnections, type HostedApplication } from './application';

/**
 * Every system-of-record integration an application declares, built once so the HTTP host and the
 * embedded CLI instance deliver and sync the same targets. `drain` accounts for the whole outbox,
 * including targets with no dispatcher in this process, such as station screens that only a
 * running host's observer drives.
 */
export function combineIntegrations(options: {
  application: HostedApplication;
  workspaceId: string;
  connections: ApplicationConnections;
}) {
  const all: readonly TargetIntegration<any>[] = options.connections.integrations ?? [];
  const targets = all.map((integration) => integration.target);
  const twice = targets.find((target, index) => targets.indexOf(target) !== index);
  if (twice) throw new Error(`Target "${twice}" has two integrations`);
  return {
    all,
    /** The integration for one target; fails when the application declares none by that name. */
    target(name: string) {
      const integration = all.find((candidate) => candidate.target === name);
      if (!integration) throw new Error(`No integration for target "${name}"`);
      return integration;
    },
    start(intervals?: { deliverMs?: number; syncMs?: number }) {
      for (const integration of all) integration.start(intervals);
    },
    async stop() {
      await Promise.all(all.map((integration) => integration.stop()));
    },
    drain(timeoutMs: number) {
      return drainTargets({
        application: options.application,
        context: hostContext(options.workspaceId),
        dispatchers: all.map((integration) => integration.dispatcher),
        timeoutMs,
      });
    },
    /** One inbound pass per target, in order; a failing target stops the pass. */
    async sync() {
      const reports = [];
      for (const { inbound } of all)
        reports.push({ target: inbound.target, ...(await inbound.runOnce()) });
      return reports;
    },
  };
}
export type Integrations = ReturnType<typeof combineIntegrations>;
