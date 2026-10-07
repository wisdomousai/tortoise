import { resolve } from 'node:path';
import type { AnyApplicationDefinition } from '@agent-native/host/application';
import { serve } from '@agent-native/host/serve';
import { securityFromEnvironment } from '@agent-native/host/security';

/**
 * Sidecar entry used by the desktop shell and `bun run dev`; configuration comes from the
 * environment the native host prepares. The application CLI (`./cli.ts`) offers the same
 * authority as `serve` with flags. Without `WEB_ROOT`, the web build of this application is served.
 * `AGENT_NATIVE_SITE_POLICY` and `AGENT_NATIVE_AUDIT_LOG` select the site policy and audit log.
 */
export async function runService(definition: AnyApplicationDefinition) {
  return serve(definition, {
    workspacePath: resolve(process.env.WORKSPACE_PATH ?? '.workspace'),
    port: Number(process.env.PORT ?? 4317),
    webRoot: resolve(process.env.WEB_ROOT ?? `dist/web/${definition.manifest.id}`),
    runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
    security: securityFromEnvironment(process.env),
  });
}

if (import.meta.main) {
  const { configuredApplication } = await import('./application');
  await runService(await configuredApplication());
}
