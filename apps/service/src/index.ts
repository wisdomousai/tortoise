import { resolve } from 'node:path';
import type { AnyApplicationDefinition } from '@tortoise/host/application';
import { serve } from '@tortoise/host/serve';
import { readPluginSettings } from '@tortoise/host';

/**
 * Sidecar entry used by the desktop shell and `bun run dev`; configuration comes from the
 * environment the native host prepares. The application CLI (`./cli.ts`) offers the same
 * instance as `serve` with flags. Without `WEB_ROOT`, the web build of this application is served.
 * Plugin settings come from the environment variables the composed plugins declare, for example
 * the security plugin's `TORTOISE_SITE_POLICY` and `TORTOISE_AUDIT_LOG`. With `identity`,
 * the application's URL scheme is the default for the OS plugin's scheme setting. With
 * `hostedWorkspace`, the workspace lives in the Postgres database `TORTOISE_DATABASE_URL` names.
 */
export async function runService(
  definition: AnyApplicationDefinition,
  identity?: { readonly scheme: string },
  options: { readonly hostedWorkspace?: string } = {},
) {
  // The application's URL scheme reaches the OS plugin as its default scheme setting; the
  // launcher's environment wins, and an application without the plugin ignores it.
  const env = identity ? { TORTOISE_OS_SCHEME: identity.scheme, ...process.env } : process.env;
  // Loaded only when asked for, so the desktop sidecar never loads the Postgres client.
  const platform = options.hostedWorkspace
    ? (await import('@tortoise/host/platform/hosted')).hostedPlatformFromEnvironment(
        options.hostedWorkspace,
      )
    : undefined;
  return serve(definition, {
    ...(platform ? { platform } : {}),
    workspacePath: resolve(process.env.WORKSPACE_PATH ?? '.workspace'),
    port: Number(process.env.PORT ?? 4317),
    webRoot: resolve(process.env.WEB_ROOT ?? `dist/web/${definition.manifest.id}`),
    runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
    settings: readPluginSettings(definition.manifest, env),
  });
}

if (import.meta.main) {
  const { configuredApplication, starterConfig } = await import('./application');
  await runService(await configuredApplication(), starterConfig());
}
