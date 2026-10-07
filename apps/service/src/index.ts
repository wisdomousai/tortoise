import { resolve } from 'node:path';
import { startHost } from './host';

const host = await startHost({
  workspacePath: resolve(process.env.WORKSPACE_PATH ?? '.workspace'),
  port: Number(process.env.PORT ?? 4317),
  webRoot: resolve(process.env.WEB_ROOT ?? 'dist/web'),
  runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
});
console.log(
  JSON.stringify({
    type: 'listening',
    url: host.url,
    workspacePath: host.workspacePath,
    launchUrl: host.launchUrl,
    connectionFile: host.connectionFile,
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
