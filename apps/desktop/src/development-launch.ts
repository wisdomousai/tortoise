import { isAbsolute } from 'node:path';

/**
 * How `bun run dev` starts the desktop window from this checkout.
 *
 * Purpose: open the same Electron shell as a packaged build without staging native
 * runtimes or a compiled service. The window still attaches to a workspace instance
 * or starts one; Bun runs `apps/service` from source.
 *
 * Trust boundary: this path exists only when Electron reports the app is unpackaged
 * and the launcher set `AGENT_NATIVE_DESKTOP_DEV=1`. A packaged process ignores the
 * flag and keeps digest checks. The service child receives the developer environment
 * already present on that launch (the same process environment as the browser `dev`
 * command). It cannot override the workspace, port, web root, runtime manifest or
 * site policy the host just chose, and Electron's own variables are not copied.
 * Renderer isolation is unchanged.
 *
 * Failure: a missing Bun path, service entry, web root or repository root throws
 * before a process is spawned. Relative paths are refused.
 */

const reservedServiceKeys = new Set([
  'PORT',
  'WORKSPACE_PATH',
  'WEB_ROOT',
  'AGENT_RUNTIME_MANIFEST',
  'AGENT_NATIVE_SITE_POLICY',
]);

/** Packaged Electron never takes this path, even if the development flag is set. */
export function isDevelopmentDesktop(packaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return !packaged && env.AGENT_NATIVE_DESKTOP_DEV === '1';
}

/** Per-application lock name so two examples can be open together. */
export function developmentAppName(name: string, application: string | undefined): string {
  if (!application) return name;
  const slug = application
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!slug) return name;
  return `${name}.${slug}`.slice(0, 214);
}

/** Developer environment forwarded into the source service, minus host-owned keys. */
export function developmentServiceEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (reservedServiceKeys.has(key) || key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS')
      continue;
    extra[key] = value;
  }
  return extra;
}

export interface DevelopmentServiceLaunch {
  workspace: string;
  executable: string;
  args: string[];
  webRoot: string;
  port: string;
  cwd: string;
  extraEnv: Record<string, string>;
  sitePolicy?: string;
  mirror: true;
}

function absolute(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || !isAbsolute(value)) throw new Error(`${key} must be an absolute path`);
  return value;
}

/** Options for `ensureService` when the desktop window is launched from source. */
export function developmentServiceLaunch(
  env: NodeJS.ProcessEnv,
  workspace: string,
): DevelopmentServiceLaunch {
  if (env.AGENT_NATIVE_DESKTOP_DEV !== '1') throw new Error('Not a development desktop launch');
  if (!workspace || !isAbsolute(workspace)) throw new Error('Workspace must be an absolute path');
  const port = env.PORT ?? '4317';
  if (!/^\d+$/.test(port)) throw new Error('PORT must be a numeric port');
  const sitePolicy = env.AGENT_NATIVE_SITE_POLICY;
  if (sitePolicy && !isAbsolute(sitePolicy))
    throw new Error('AGENT_NATIVE_SITE_POLICY must be an absolute path');
  return {
    workspace,
    executable: absolute(env, 'AGENT_NATIVE_BUN'),
    args: [absolute(env, 'AGENT_NATIVE_SERVICE_ENTRY')],
    webRoot: absolute(env, 'AGENT_NATIVE_WEB_ROOT'),
    port,
    cwd: absolute(env, 'AGENT_NATIVE_DEV_ROOT'),
    extraEnv: developmentServiceEnvironment(env),
    ...(sitePolicy ? { sitePolicy } : {}),
    mirror: true,
  };
}
