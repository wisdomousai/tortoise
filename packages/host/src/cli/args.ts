import { resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import { ApplicationError } from '@agent-native/contracts';
import { securityFromEnvironment, type SecurityOptions } from '../security';

export const workspaceOf = (args: string[]) =>
  resolve(takeFlag(args, 'workspace') ?? process.env.WORKSPACE_PATH ?? '.workspace');

/** Trusted launcher configuration: where the site policy and audit log are. */
export const securityOf = (args: string[]): SecurityOptions =>
  securityFromEnvironment(process.env, {
    sitePolicy: takeFlag(args, 'site-policy'),
    eventLogDirectory: takeFlag(args, 'audit-log'),
  });

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
