import { readConnection, runCliMain, takeFlag, type CliClient } from '@agent-native/adapters/cli';
import { createDirectTransport, readGrantFile } from '@agent-native/adapters/direct';
import { createHttpTransport } from '@agent-native/client';
import { ApplicationError } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { AnyApplicationDefinition } from '../application';
import { deploymentCatalog } from '../components';
import {
  LOCAL_OWNER,
  LOCAL_WORKSPACE,
  openEmbeddedAuthority,
  type EmbeddedAuthority,
} from '../embedded';
import { settingsOf, workspaceOf } from './args';

const OWNER: ExecutionContext = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const offlineVerbs = new Set(['help', 'list', 'schema', 'workflows']);

/** The published contract, for discovery without any authority. Executing is refused. */
function offlineClient(definition: AnyApplicationDefinition): CliClient {
  const catalog = deploymentCatalog(definition.manifest);
  const unavailable = () => {
    throw new ApplicationError(
      'INVALID_INPUT',
      'No authority: pass --embedded or --connection, or set AGENT_NATIVE_CONNECTION',
    );
  };
  return {
    catalog: async () => catalog,
    query: unavailable,
    command: unavailable,
    events: unavailable,
  };
}

/** An operation against a live authority, or offline discovery when none is named. */
function attachedOperation(
  definition: AnyApplicationDefinition,
  program: string,
  args: string[],
  connection: string | undefined,
) {
  const offline =
    !connection &&
    !process.env.AGENT_NATIVE_CONNECTION &&
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
  let authority: EmbeddedAuthority | undefined;
  try {
    return await runCliMain(
      args,
      async () => {
        const context: ExecutionContext = {
          ...(grantFile ? await readGrantFile(grantFile, LOCAL_WORKSPACE) : OWNER),
          channel: 'cli',
        };
        authority = await openEmbeddedAuthority(definition, { workspacePath, settings });
        // The local owner acts only where the identity port admits it; otherwise a grant is required.
        authority.ports.identity.admit(context);
        // Commits stay in the workspace outbox; `drain`, `mcp --embedded` or `serve` deliver them.
        return createDirectTransport(authority.application, context);
      },
      { program },
    );
  } finally {
    await authority?.close();
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
  const grantFile = explicitGrant ?? process.env.AGENT_NATIVE_GRANT_FILE;
  if (embedded) return embeddedOperation(definition, program, args, grantFile);
  // An attached call's identity is the connection file's session; a grant cannot apply.
  if (explicitGrant)
    throw new ApplicationError('INVALID_INPUT', '--grant-file applies to --embedded calls');
  return attachedOperation(definition, program, args, connection);
}
