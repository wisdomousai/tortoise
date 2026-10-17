import { resolve } from 'node:path';
import { takeFlag } from '@agent-native/adapters/cli';
import { readGrantFile } from '@agent-native/adapters/direct';
import { WorkspaceOwnedError } from '@agent-native/adapters/exclusive-lock';
import { ApplicationError } from '@agent-native/contracts';
import type { AnyApplicationDefinition } from '../application';
import { LOCAL_WORKSPACE } from '../embedded';
import { finite, rejectRemaining, settingsOf, workspaceOf } from './args';

/** `serve`: host the authority until the process is stopped. */
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
  const platform = hostedWorkspace ? await hosted(hostedWorkspace) : undefined;
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
      throw new ApplicationError('CONFLICT', 'Another live authority owns this workspace');
    throw error;
  });
  return new Promise<number>(() => {});
}

/**
 * `--hosted-workspace <name>`: keep the workspace in the Postgres database that
 * `AGENT_NATIVE_DATABASE_URL` names, under the workspace's lease. The URL is read from the
 * environment, never a flag, so its credentials stay out of the process list. Losing the lease
 * stops the host with exit code 1, for the orchestrator to restart it behind the new holder.
 */
async function hosted(workspace: string) {
  const url = process.env.AGENT_NATIVE_DATABASE_URL;
  if (!url)
    throw new ApplicationError(
      'INVALID_INPUT',
      '--hosted-workspace needs AGENT_NATIVE_DATABASE_URL in the environment',
    );
  const [{ bunPostgres }, { hostedPlatform }] = await Promise.all([
    import('@agent-native/adapters/postgres-bun'),
    import('../platform/hosted'),
  ]);
  return hostedPlatform({
    database: bunPostgres(url),
    workspace,
    onLeaseLost(error) {
      console.error(JSON.stringify({ type: 'lease-lost', workspace, message: error.message }));
      process.exitCode = 1;
      process.kill(process.pid, 'SIGTERM');
    },
  });
}
