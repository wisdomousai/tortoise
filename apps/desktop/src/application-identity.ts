import { readFileSync } from 'node:fs';
export interface ApplicationIdentity {
  name: string;
  displayName: string;
  appId: string;
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
  return { name: identity.name, displayName: identity.displayName, appId: identity.appId };
}
