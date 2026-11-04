import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { takeFlag } from '@tortoise/adapters/cli';
import { acquireWorkspaceOwnership } from '@tortoise/adapters/ownership';
import { restoreBackup, verifyBackup } from '@tortoise/adapters/workspace-backup';
import { ApplicationError } from '@tortoise/contracts';
import type { AnyApplicationDefinition } from '../application';
import { workspaceStorage } from '../platform/bun';
import { rejectRemaining, report, workspaceOf } from './args';

function required(args: string[], flag: string) {
  const value = takeFlag(args, flag);
  if (!value) throw new ApplicationError('INVALID_INPUT', `--${flag} is required`);
  return resolve(value);
}

/**
 * `backup --out file`: an online, verified copy of the workspace database. It opens its own
 * connection, so it runs beside a serving host; SQLite gives it a consistent read.
 */
export async function backupCommand(definition: AnyApplicationDefinition, args: string[]) {
  const workspacePath = await realpath(workspaceOf(args));
  const out = required(args, 'out');
  rejectRemaining(args);
  const storage = workspaceStorage(definition, workspacePath);
  try {
    await storage.backup(out);
  } finally {
    await storage.close();
  }
  report({ backup: out, ...verifyBackup(out) });
  return 0;
}

/**
 * `restore --from file`: replace the workspace database with a verified backup. It takes the
 * workspace's ownership lock first, so it refuses while a host serves the workspace.
 */
export async function restoreCommand(_definition: AnyApplicationDefinition, args: string[]) {
  const ownership = await acquireWorkspaceOwnership(workspaceOf(args));
  try {
    const from = required(args, 'from');
    rejectRemaining(args);
    const summary = await restoreBackup(from, join(ownership.canonicalPath, 'workspace.sqlite'));
    report({ restored: from, ...summary });
    return 0;
  } finally {
    await ownership.release();
  }
}
