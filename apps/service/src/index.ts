import { resolve } from 'node:path';
import { serve } from './serve';

// Sidecar entry used by the desktop shell and `bun run dev`; configuration comes from the
// environment the native host prepares. The application CLI (`./cli.ts`) offers the same
// authority as `serve` with flags.
await serve({
  workspacePath: resolve(process.env.WORKSPACE_PATH ?? '.workspace'),
  port: Number(process.env.PORT ?? 4317),
  webRoot: resolve(process.env.WEB_ROOT ?? 'dist/web'),
  runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
});
