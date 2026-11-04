import { readConnection, runCliMain, takeFlag, type CliClient } from '@tortoise/adapters/cli';
import { createDirectTransport, readGrantFile } from '@tortoise/adapters/direct';
import { createHttpTransport } from '@tortoise/client';
import { ApplicationError } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import type { AnyApplicationDefinition } from '../application';
import { deploymentCatalog } from '../components';
import {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openEmbeddedInstance,
  type EmbeddedInstance,
} from '../embedded';
import { settingsOf, workspaceOf } from './args';

const OWNER: ExecutionContext = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const offlineVerbs = new Set(['help', 'list', 'schema', 'workflows']);

/** The published contract, for discovery without any instance. Executing is refused. */
function offlineClient(definition: AnyApplicationDefinition): CliClient {
  const catalog = deploymentCatalog(definition.manifest);
  const unavailable = () => {
    throw new ApplicationError(
      'INVALID_INPUT',
      'No instance: pass --embedded or --connection, or set TORTOISE_CONNECTION',
    );
  };
  return {
    catalog: async () => catalog,
    query: unavailable,
    command: unavailable,
    events: unavailable,
  };
}

/** An operation against a live instance, or offline discovery when none is named. */
function attachedOperation(
  definition: AnyApplicationDefinition,
  program: string,
  args: string[],
  connection: string | undefined,
) {
  const offline =
    !connection &&
    !process.env.TORTOISE_CONNECTION &&
    (args.length === 0 || offlineVerbs.has(args[0]!) || args.includes('--help'));
  return runCliMain(
    args,
    offline
      ? offlineClient(definition)
      : async () => {
          const file = await readConnection(connection).catch((error: Error) => {
            throw new ApplicationError('INVALID_INPUT', error.message);
          });
          return createHttpTransport({ baseUrl: file.endpoint, token: file.token });
        },
    { program },
  );
}

/** An operation in-process, as the grant file's delegate or else the local owner. */
async function embeddedOperation(
  definition: AnyApplicationDefinition,
  program: string,
  args: string[],
  grantFile: string | undefined,
) {
  const workspacePath = workspaceOf(args);
  const settings = settingsOf(definition.manifest, args);
  let instance: EmbeddedInstance | undefined;
  try {
    return await runCliMain(
      args,
      async () => {
        const context: ExecutionContext = {
          ...(grantFile ? await readGrantFile(grantFile, LOCAL_WORKSPACE) : OWNER),
          channel: 'cli',
        };
        instance = await openEmbeddedInstance(definition, { workspacePath, settings });
        // The local owner acts only where the identity port admits it; otherwise a grant is required.
        instance.ports.identity.admit(context);
        // Commits stay in the workspace outbox; `drain`, `mcp --embedded` or `serve` deliver them.
        return createDirectTransport(instance.application, context);
      },
      { program },
    );
  } finally {
    await instance?.close();
  }
}

/** Any capability operation, attached (`--connection`) or `--embedded`. */
export async function operationCommand(
  definition: AnyApplicationDefinition,
  program: string,
  args: string[],
) {
  const embedded = takeFlag(args, 'embedded', false) !== undefined;
  const connection = takeFlag(args, 'connection');
  const explicitGrant = takeFlag(args, 'grant-file');
  const grantFile = explicitGrant ?? process.env.TORTOISE_GRANT_FILE;
  if (embedded) return embeddedOperation(definition, program, args, grantFile);
  // An attached call's identity is the connection file's session; a grant cannot apply.
  if (explicitGrant)
    throw new ApplicationError('INVALID_INPUT', '--grant-file applies to --embedded calls');
  return attachedOperation(definition, program, args, connection);
}
