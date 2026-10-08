import { resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import { ApplicationError } from '@agent-native/contracts';
import type { ApplicationManifest } from '../manifest';
import { readPluginSettings, type PluginSettings } from '../plugins/settings';

export const workspaceOf = (args: string[]) =>
  resolve(takeFlag(args, 'workspace') ?? process.env.WORKSPACE_PATH ?? '.workspace');

/** Trusted launcher configuration: the composed plugins' settings, from flags or else env. */
export const settingsOf = (manifest: ApplicationManifest, args: string[]): PluginSettings =>
  readPluginSettings(manifest, process.env, args);

export function finite(value: string | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0)
    throw new ApplicationError('INVALID_INPUT', `--${name} must be a non-negative integer`);
  return number;
}

export function rejectRemaining(args: string[]) {
  if (args.length) throw new ApplicationError('INVALID_INPUT', `Unexpected argument "${args[0]}"`);
}

/** Print one JSON value; diagnostics go to stderr so stdout stays machine-readable. */
export function report(value: unknown) {
  console.log(JSON.stringify(value));
}
