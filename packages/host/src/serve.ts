import type { ExecutionContext } from '@agent-native/runtime';
import type { AnyApplicationDefinition } from './application';
import { startHost } from './host';
import type { ServingPlatform } from './platform/bun';
import type { PluginSettings } from './plugins/settings';

/**
 * Run the HTTP instance for one application until SIGINT/SIGTERM. The first stdout line is a
 * `listening` JSON record; the desktop shell and tests read it to find the launch URL and
 * connection file.
 */
export async function serve(
  definition: AnyApplicationDefinition,
  options: {
    workspacePath: string;
    port: number;
    webRoot?: string;
    runtimeManifest?: string;
    agentConnection?: { context: ExecutionContext; path: string };
    settings?: PluginSettings;
    platform?: ServingPlatform;
  },
) {
  const host = await startHost(definition, options);
  console.log(
    JSON.stringify({
      type: 'listening',
      application: definition.manifest.id,
      url: host.url,
      workspacePath: host.workspacePath,
      launchUrl: host.launchUrl,
      connectionFile: host.connectionFile,
      ...(options.agentConnection ? { agentConnectionFile: options.agentConnection.path } : {}),
      instance: host.instance,
      ...(host.build ? { build: host.build } : {}),
      plugins: host.plugins,
    }),
  );
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void host.close().then(() => process.exit(process.exitCode ?? 0));
    });
  return host;
}
