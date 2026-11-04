import { resolve } from 'node:path';
import { takeFlag } from '@tortoise/adapters/cli';
import { readGrantFile } from '@tortoise/adapters/direct';
import { WorkspaceOwnedError } from '@tortoise/adapters/exclusive-lock';
import { ApplicationError } from '@tortoise/contracts';
import type { AnyApplicationDefinition } from '../application';
import { LOCAL_WORKSPACE } from '../embedded';
import { finite, rejectRemaining, settingsOf, workspaceOf } from './args';

/** `serve`: host the instance until the process is stopped. */
export async function serveCommand(definition: AnyApplicationDefinition, args: string[]) {
  const workspacePath = workspaceOf(args);
  const settings = settingsOf(definition.manifest, args);
  const port = finite(takeFlag(args, 'port'), 4317, 'port');
  const webRoot = takeFlag(args, 'web-root');
  const grantFile = takeFlag(args, 'grant-file');
  const grantConnection = takeFlag(args, 'grant-connection');
  const hostedWorkspace = takeFlag(args, 'hosted-workspace');
  rejectRemaining(args);
  if (!grantFile !== !grantConnection)
    throw new ApplicationError(
      'INVALID_INPUT',
      '--grant-file and --grant-connection are used together',
    );
  // Loaded lazily: provider access and the web host are not needed by embedded commands.
  const { serve } = await import('../serve');
  const platform = hostedWorkspace
    ? (await import('../platform/hosted')).hostedPlatformFromEnvironment(hostedWorkspace)
    : undefined;
  await serve(definition, {
    ...(platform ? { platform } : {}),
    workspacePath,
    port,
    ...(webRoot ? { webRoot: resolve(webRoot) } : {}),
    runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
    settings,
    ...(grantFile
      ? {
          agentConnection: {
            context: await readGrantFile(grantFile, LOCAL_WORKSPACE),
            path: resolve(grantConnection!),
          },
        }
      : {}),
  }).catch((error: unknown) => {
    if (error instanceof WorkspaceOwnedError)
      throw new ApplicationError('CONFLICT', 'Another live instance owns this workspace');
    throw error;
  });
  return new Promise<number>(() => {});
}
