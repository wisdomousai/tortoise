import { readFileSync } from 'node:fs';
import { readStarterConfig, type StarterConfig } from './config';

/**
 * The application the mobile app hosts. `targets.mobile.application` in `app.config.json` names
 * it when the phone runs a different application than the desktop (a field application beside the
 * hub); without it the mobile app hosts the starter's `application`. `AGENT_NATIVE_MOBILE_APPLICATION`
 * in `env` overrides both for a developer's own build, as `AGENT_NATIVE_APPLICATION` does for the
 * desktop. Fails on unknown fields under `targets` or `targets.mobile`, so a typo is not ignored.
 */
export function readMobileTarget(
  path: string,
  env: Record<string, string | undefined> = process.env,
): StarterConfig {
  const { targets } = JSON.parse(readFileSync(path, 'utf8')) as { targets?: unknown };
  const mobile = record(targets, 'targets', ['mobile'])?.mobile;
  const application = record(mobile, 'targets.mobile', ['application'])?.application;
  if (application !== undefined && (typeof application !== 'string' || !application.trim()))
    throw new Error(`${path}: targets.mobile.application must name an application`);
  return readStarterConfig(path, {
    AGENT_NATIVE_APPLICATION:
      env.AGENT_NATIVE_MOBILE_APPLICATION || (application as string | undefined),
  });
}

function record(value: unknown, name: string, fields: readonly string[]) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) throw new Error(`Unknown ${name} fields: ${unknown.join(', ')}`);
  return value as Record<string, unknown>;
}
