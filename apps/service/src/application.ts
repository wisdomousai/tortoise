import { resolve } from 'node:path';
import { loadApplication, readStarterConfig } from '@agent-native/host/config';

/**
 * The starter's composition point: the one place it learns which content it hosts. The
 * application comes from `app.config.json` (or `AGENT_NATIVE_APPLICATION` for development) and
 * is resolved at runtime, so the starter never imports `showcase/*`. Compiled builds
 * generate a static entry for the same application instead (`scripts/application-entry.ts`).
 */
export const starterConfigPath = resolve(import.meta.dir, '../../../app.config.json');

export function starterConfig(env: Record<string, string | undefined> = process.env) {
  return readStarterConfig(starterConfigPath, env);
}

export async function configuredApplication(env?: Record<string, string | undefined>) {
  return loadApplication(starterConfig(env));
}
