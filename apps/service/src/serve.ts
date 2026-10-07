import type { ExecutionContext } from '@agent-native/runtime';
import { startHost } from './host';
import { demoStations, demoSystemOfRecord } from './demo';

/**
 * Run the HTTP authority until SIGINT/SIGTERM. The first stdout line is a `listening` JSON
 * record; the desktop shell and tests read it to find the launch URL and connection file.
 */
export async function serve(options: {
  workspacePath: string;
  port: number;
  webRoot?: string;
  runtimeManifest?: string;
  agentConnection?: { context: ExecutionContext; path: string };
}) {
  const host = await startHost({
    ...options,
    systemOfRecord: demoSystemOfRecord(),
    lineStation: { stations: demoStations() },
  });
  console.log(
    JSON.stringify({
      type: 'listening',
      url: host.url,
      workspacePath: host.workspacePath,
      launchUrl: host.launchUrl,
      connectionFile: host.connectionFile,
      ...(options.agentConnection ? { agentConnectionFile: options.agentConnection.path } : {}),
      instance: host.instance,
    }),
  );
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void host.close().then(() => process.exit(0));
    });
  return host;
}
