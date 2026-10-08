import { resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import { readGrantFile } from '@agent-native/adapters/direct';
import { ApplicationError } from '@agent-native/contracts';
import type { AnyApplicationDefinition } from '../application';
import { LOCAL_WORKSPACE } from '../embedded';
import { finite, rejectRemaining, securityOf, workspaceOf } from './args';

/** `serve`: host the authority until the process is stopped. */
export async function serveCommand(definition: AnyApplicationDefinition, args: string[]) {
  const workspacePath = workspaceOf(args);
  const security = securityOf(args);
  const port = finite(takeFlag(args, 'port'), 4317, 'port');
  const webRoot = takeFlag(args, 'web-root');
  const grantFile = takeFlag(args, 'grant-file');
  const grantConnection = takeFlag(args, 'grant-connection');
  rejectRemaining(args);
  if (!grantFile !== !grantConnection)
    throw new ApplicationError(
      'INVALID_INPUT',
      '--grant-file and --grant-connection are used together',
    );
  // Loaded lazily: provider access and the web host are not needed by embedded commands.
  const { serve } = await import('../serve');
  await serve(definition, {
    workspacePath,
    port,
    ...(webRoot ? { webRoot: resolve(webRoot) } : {}),
    runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
    security,
    ...(grantFile
      ? {
          agentConnection: {
            context: await readGrantFile(grantFile, LOCAL_WORKSPACE),
            path: resolve(grantConnection!),
          },
        }
      : {}),
  });
  return new Promise<number>(() => {});
}
