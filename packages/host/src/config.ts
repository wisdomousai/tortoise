import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnyApplicationDefinition } from './application';
import type { ApplicationManifest } from './manifest';

export interface ApplicationIdentity {
  name: string;
  displayName: string;
  appId: string;
  /**
   * The custom URL scheme OS link handlers register under. `app.config.json` may set it; the
   * default is the reverse-DNS `appId` in lower case (RFC 8252), so content never names one.
   */
  scheme: string;
}

const reservedSchemes = new Set(
  'about blob data file ftp http https javascript mailto sms tel ws wss content intent'.split(' '),
);
/** A valid, unreserved RFC 3986 scheme, from configuration or derived from the application ID. */
function urlScheme(configured: unknown, appId: string): string {
  if (configured !== undefined && typeof configured !== 'string')
    throw new Error('Invalid application identity fields');
  const scheme = configured ?? appId.toLowerCase().replace(/_/g, '-');
  if (!/^[a-z][a-z0-9+.-]{1,63}$/.test(scheme) || reservedSchemes.has(scheme))
    throw new Error(`Invalid URL scheme "${scheme}"`);
  return scheme;
}
/**
 * The starter's configuration (`app.config.json`): its platform identity and the one application
 * it hosts. `application` is a module specifier for content: a package name such as
 * `@agent-native/project-tasks`, or a path relative to the config file. It names a directory
 * whose `manifest`, `application` and `screens` entrypoints the starter resolves.
 */
export interface StarterConfig extends ApplicationIdentity {
  application: string;
}

/** Trusted build/host configuration, copied unchanged into each immutable stage.
 * Validate it at both boundaries so a scaffold cannot accidentally ship starter
 * identity or generate an invalid platform application identifier. */
export function readApplicationIdentity(path: string): ApplicationIdentity {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid application identity');
  const identity = value as Record<string, unknown>;
  if (
    typeof identity.name !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,213}$/.test(identity.name) ||
    typeof identity.displayName !== 'string' ||
    !identity.displayName.trim() ||
    identity.displayName.length > 120 ||
    /[\x00-\x1f]/.test(identity.displayName) ||
    typeof identity.appId !== 'string' ||
    identity.appId.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(identity.appId)
  )
    throw new Error('Invalid application identity fields');
  return {
    name: identity.name,
    displayName: identity.displayName,
    appId: identity.appId,
    scheme: urlScheme(identity.scheme, identity.appId),
  };
}

/**
 * Read the starter configuration. `AGENT_NATIVE_APPLICATION` in `env` overrides the configured
 * application, so one starter checkout can run any example during development; it comes from
 * the developer's own launch, never from callers. Fails when either is missing or malformed.
 */
export function readStarterConfig(
  path: string,
  env: Record<string, string | undefined> = process.env,
): StarterConfig {
  const identity = readApplicationIdentity(path);
  const configured = (JSON.parse(readFileSync(path, 'utf8')) as { application?: unknown })
    .application;
  const application = env.AGENT_NATIVE_APPLICATION || configured;
  if (typeof application !== 'string' || !application.trim())
    throw new Error(`${path} must name the application the starter hosts`);
  return { ...identity, application: resolveSpecifier(application, dirname(path)) };
}

/** Package names stay as they are; relative and absolute paths resolve against the config. */
function resolveSpecifier(specifier: string, base: string): string {
  if (specifier.startsWith('.') || isAbsolute(specifier)) return resolve(base, specifier);
  if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(specifier))
    throw new Error(`Invalid application specifier "${specifier}"`);
  return specifier;
}

/** The module specifier of one entrypoint of the configured application. */
export function applicationEntry(
  config: StarterConfig,
  entry: 'manifest' | 'application' | 'screens',
) {
  return isAbsolute(config.application)
    ? pathToFileURL(resolve(config.application, entry)).href
    : `${config.application}/${entry}`;
}

/**
 * Load the configured application's server definition (its default export). Server entrypoints
 * only: compiled builds cannot follow this dynamic import, so they generate a static entry instead.
 */
export async function loadApplication(config: StarterConfig): Promise<AnyApplicationDefinition> {
  const module = (await import(applicationEntry(config, 'application'))) as {
    default?: AnyApplicationDefinition;
  };
  if (!module.default?.manifest)
    throw new Error(`${config.application}/application has no default application definition`);
  return module.default;
}

/** Load only the browser-safe manifest, for generators and checks that must not load handlers. */
export async function loadManifest(config: StarterConfig): Promise<ApplicationManifest> {
  const module = (await import(applicationEntry(config, 'manifest'))) as {
    default?: ApplicationManifest;
  };
  if (!module.default?.modules)
    throw new Error(`${config.application}/manifest has no default manifest`);
  return module.default;
}
