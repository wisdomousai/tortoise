import { defineHostPlugin, type PluginOpenContext } from '@tortoise/host/plugin';
import { createBroker } from './broker';
import { executionHostPluginManifest } from './plugin-manifest';
import { createExecutionHost, type ExecutionHost, type ExecutionHostOptions } from './run';

/**
 * The execution host plugin. Its service (`services['execution-host']`) runs tasks in
 * bubblewrap sandboxes started through the process port, each acting as one delegated context
 * through a token only this plugin issues and accepts.
 *
 * Trust boundary: the caller of `run` is trusted host code (an agent run, a trigger job), and it
 * decides the task and the context. The sandbox is not trusted: it sees the tools and paths the
 * task names, reaches the host API with a token bound to the run and its grant, and reaches the
 * network only through the network proxy, for the destinations its declaration lists.
 */
export function createExecutionHostPlugin(options: ExecutionHostOptions) {
  return defineHostPlugin({
    manifest: executionHostPluginManifest,
    requires: ['process'],
    async open(context: PluginOpenContext) {
      const broker = createBroker();
      let origin: string | undefined;
      const sandboxes = new Map(
        context.catalog.requirements.processes
          .filter((process) => process.executable === 'bwrap')
          .map((process) => [process.id, { network: !!process.network?.length }] as const),
      );
      const host = createExecutionHost(
        { ports: context.ports, broker, origin: () => origin, sandboxes, now: Date.now },
        options,
      );
      const service: ExecutionHost = {
        availability: host.availability,
        start: host.start,
        run: host.run,
      };
      return {
        service,
        async start(started) {
          if (started.origin) origin = started.origin;
          return [];
        },
        authenticate: async (token) => broker.authenticate(token),
        describe: () => ({
          sandboxes: [...sandboxes.keys()].sort(),
          tools: Object.keys(options.tools).sort(),
        }),
        async close() {
          host.stopAll();
        },
      };
    },
  });
}
