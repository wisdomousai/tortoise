import { createHttpTransport } from '@agent-native/client';
import { ApplicationError, errorEnvelope, type ErrorCode } from '@agent-native/contracts';
import { operationInput, resolveOperation, takeFlag, usageError } from './cli/args';
import { readConnection } from './cli/connection';
import { execute, validateOnly } from './cli/execute';
import { formatText } from './cli/format';
import { operationHelp, overview } from './cli/help';
import { CliText, type CliClient, type CliOptions } from './cli/types';

export { readConnection, type ConnectionFile } from './cli/connection';
export { takeFlag } from './cli/args';
export { formatText } from './cli/format';
export { CliText, type CliClient, type CliOptions } from './cli/types';

/**
 * Process exit status per error code, so a shell or harness can branch without parsing output.
 * 0 is success; 1 is reserved for internal failures; usage errors share INVALID_INPUT.
 */
export const exitCodes = {
  INTERNAL: 1,
  INVALID_OUTPUT: 1,
  INVALID_INPUT: 2,
  NOT_FOUND: 3,
  FORBIDDEN: 4,
  CONFLICT: 5,
  IDEMPOTENCY_CONFLICT: 6,
  CANCELLED: 7,
  UNAVAILABLE: 8,
} as const satisfies Record<ErrorCode, number>;
/** Work committed locally is still waiting for an external system (sysexits EX_TEMPFAIL). */
export const PENDING_EXIT_CODE = 75;

export const exitCodeFor = (error: unknown) => exitCodes[errorEnvelope(error).code];

/** `workflows` lists every workflow; `workflows <id>` shows one. */
function workflows(catalog: Awaited<ReturnType<CliClient['catalog']>>, id: string | undefined) {
  if (!id)
    return catalog.workflows.map((workflow) => ({
      id: workflow.id,
      operations: workflow.operations,
    }));
  const workflow = catalog.workflows.find((item) => item.id === id);
  if (!workflow) throw new ApplicationError('NOT_FOUND', `Unknown workflow ${id}`);
  return workflow;
}

/**
 * Testable CLI dispatcher over any transport. The authority decides identity and authorization;
 * this layer only maps arguments to the catalog. JSON output is the default, one value per run.
 */
export async function runCli(
  argv: readonly string[],
  client: CliClient,
  options: CliOptions = {},
): Promise<unknown> {
  const program = options.program ?? 'cli';
  const args = [...argv];
  const help = takeFlag(args, 'help', false) !== undefined;
  const [verb] = args;
  const catalog = await client.catalog();
  if (!verb) return help ? overview(catalog, program) : catalog;
  if (verb === 'list') return catalog;
  if (verb === 'help') {
    const words = args.slice(1);
    return words.length
      ? operationHelp(resolveOperation(catalog, words), program)
      : overview(catalog, program);
  }
  if (verb === 'schema') {
    const words = args.slice(1);
    return words.length ? resolveOperation(catalog, words) : catalog;
  }
  if (verb === 'workflows') return workflows(catalog, args[1]);
  const words: string[] = [];
  while (args.length && !args[0]!.startsWith('--')) words.push(args.shift()!);
  const operation = resolveOperation(catalog, words);
  if (help) return operationHelp(operation, program);
  const dryRun = takeFlag(args, 'dry-run', false) !== undefined;
  const key = operation.kind === 'command' ? takeFlag(args, 'key') : undefined;
  const revisions = operation.kind === 'command' ? takeFlag(args, 'revisions') : undefined;
  const input = await operationInput(operation, args, options);
  if (dryRun) return validateOnly(operation, input);
  return execute(client, operation, input, key, revisions);
}

/**
 * Run, print one result to stdout and set the exit status. Errors print a JSON error envelope (or
 * `CODE: message` with --output text) and exit with the code mapped from the error.
 */
export async function runCliMain(
  argv: readonly string[],
  client: CliClient | (() => Promise<CliClient>),
  options: CliOptions = {},
): Promise<number> {
  const args = [...argv];
  let output = 'json';
  try {
    output = takeFlag(args, 'output') ?? 'json';
    if (output !== 'json' && output !== 'text') throw usageError('--output must be json or text');
    const value = await runCli(
      args,
      typeof client === 'function' ? await client() : client,
      options,
    );
    console.log(
      output === 'text' || value instanceof CliText ? formatText(value) : JSON.stringify(value),
    );
    return 0;
  } catch (error) {
    const envelope = errorEnvelope(error);
    if (output === 'text') console.log(`${envelope.code}: ${envelope.message}`);
    else console.log(JSON.stringify({ error: envelope }));
    return exitCodes[envelope.code];
  }
}

if (import.meta.main) {
  process.exitCode = await runCliMain(process.argv.slice(2), async () => {
    try {
      const connection = await readConnection();
      return createHttpTransport({ baseUrl: connection.endpoint, token: connection.token });
    } catch (error) {
      throw usageError(error instanceof Error ? error.message : 'Connection unavailable');
    }
  });
}
