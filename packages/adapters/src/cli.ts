import { createHttpTransport, type Transport } from '@agent-native/client';
import {
  ApplicationError,
  errorEnvelope,
  type Catalog,
  type CatalogOperation,
  type ErrorCode,
  type JsonValue,
} from '@agent-native/contracts';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { commandWords, fieldSpecs, synopsis, type FieldSpec } from './cli-syntax';

export interface ConnectionFile {
  endpoint: string;
  token: string;
}
/** Process clients attach to the running authority, never open its data files. */
export async function readConnection(
  path = process.env.AGENT_NATIVE_CONNECTION,
): Promise<ConnectionFile> {
  if (!path)
    throw new Error(
      'Set AGENT_NATIVE_CONNECTION to the protected connection file printed by the service',
    );
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('endpoint' in value) ||
    !('token' in value) ||
    typeof value.endpoint !== 'string' ||
    typeof value.token !== 'string'
  )
    throw new Error('Invalid connection file');
  const url = new URL(value.endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/'
  )
    throw new Error('Connection must use a loopback authority');
  return { endpoint: value.endpoint, token: value.token };
}

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

/** Help and workflow text printed verbatim instead of as a JSON value. */
export class CliText {
  constructor(readonly text: string) {}
}

export type CliClient = Transport & { catalog(): Promise<Catalog> };
export interface CliOptions {
  /** Name shown in usage text; the compiled binary passes its application name. */
  readonly program?: string;
  /** Source for `--json -`. Never read implicitly, so a harness cannot hang on an open stdin. */
  readonly readStdin?: () => Promise<string>;
}

const usageError = (message: string, details?: JsonValue) =>
  new ApplicationError('INVALID_INPUT', message, details);

/** Remove `--name value` / `--name=value` (or a bare boolean switch) from `args`. */
export function takeFlag(args: string[], name: string, takesValue = true): string | undefined {
  const index = args.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index < 0) return undefined;
  const [arg] = args.splice(index, 1);
  if (arg!.includes('=')) return arg!.slice(name.length + 3);
  if (!takesValue) return 'true';
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw usageError(`--${name} requires a value`);
  args.splice(index, 1);
  return value;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw usageError(`${what} must be valid JSON`);
  }
}

function coerce(field: FieldSpec, raw: string | true): unknown {
  const invalid = () =>
    usageError(`--${field.flag} expects ${field.type === 'json' ? 'JSON' : `a ${field.type}`}`, {
      field: field.property,
    });
  if (raw === true) {
    if (field.type !== 'boolean') throw usageError(`--${field.flag} requires a value`);
    return true;
  }
  if (field.nullable && raw === 'null') return null;
  switch (field.type) {
    case 'integer':
      if (!/^-?\d+$/.test(raw)) throw invalid();
      return Number(raw);
    case 'number': {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) throw invalid();
      return value;
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw invalid();
      return raw === 'true';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        throw invalid();
      }
    default:
      return raw;
  }
}

/** Resolve `inspection result record` or `inspection.result.record` against the catalog. */
function resolveOperation(catalog: Catalog, words: readonly string[]) {
  const id = words.length === 1 ? words[0]! : words.join('.');
  const operation = catalog.operations.find((item) => item.id === id);
  if (operation) return operation;
  const prefix = `${id}.`;
  const candidates = catalog.operations
    .filter((item) => item.id.startsWith(prefix))
    .map((item) => commandWords(item).join(' '));
  throw usageError(
    candidates.length
      ? `Incomplete command; choose one of: ${candidates.join(', ')}`
      : `Unknown command "${words.join(' ')}"; run help`,
    { candidates },
  );
}

/** Build domain input from `--json` plus one flag per top-level input property. */
async function operationInput(
  operation: CatalogOperation,
  args: string[],
  options: CliOptions,
): Promise<unknown> {
  const json = takeFlag(args, 'json');
  let base: unknown = {};
  if (json !== undefined)
    base = parseJson(
      json === '-' ? await (options.readStdin ?? (() => Bun.stdin.text()))() : json,
      '--json',
    );
  const fields = fieldSpecs(operation.inputSchema);
  const values: Record<string, unknown> = {};
  while (args.length) {
    const arg = args.shift()!;
    if (!arg.startsWith('--')) throw usageError(`Unexpected argument "${arg}"`);
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const field = fields.find((item) => item.flag === name || item.property === name);
    if (!field)
      throw usageError(`Unknown flag --${name} for ${operation.id}`, {
        flags: fields.map((item) => `--${item.flag}`),
      });
    if (Object.hasOwn(values, field.property)) throw usageError(`--${name} given twice`);
    const next = args[0];
    const raw =
      inline ?? (next === undefined || next.startsWith('--') ? true : (args.shift() as string));
    values[field.property] = coerce(field, raw);
  }
  if (!Object.keys(values).length) return base;
  if (!base || typeof base !== 'object' || Array.isArray(base))
    throw usageError('--json must be an object when combined with field flags');
  return { ...base, ...values };
}

function operationHelp(operation: CatalogOperation, program: string): CliText {
  const fields = fieldSpecs(operation.inputSchema);
  const lines = [
    synopsis(operation, program),
    '',
    operation.description || operation.id,
    '',
    `Kind: ${operation.kind}${operation.kind === 'command' ? ' (changes state; pass --key to retry safely)' : ''}`,
  ];
  if (operation.integration)
    lines.push(
      `Forwarded to ${operation.integration.target} after commit; a receipt is not acceptance.`,
    );
  if (fields.length) {
    lines.push('', 'Flags:');
    const width = Math.max(...fields.map((field) => field.flag.length)) + 2;
    for (const field of fields)
      lines.push(
        `  --${field.flag.padEnd(width)}${field.type}${field.choices.length ? ` (${field.choices.join(', ')})` : ''}${field.required ? ', required' : ''}${field.nullable ? ', or null' : ''}${field.description ? ` — ${field.description}` : ''}`,
      );
  }
  lines.push(
    '',
    'Also: --json <object|-> for the whole input, --dry-run to validate without executing,',
    '--output json|text. Commands accept --key <id> and --revisions <json>.',
  );
  return new CliText(lines.join('\n'));
}

const firstSentence = (text: string) => {
  const sentence = text.split(/(?<=\.)\s/)[0]!.split('\n')[0]!;
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
};

function overview(catalog: Catalog, program: string): CliText {
  const rows = catalog.operations.map((operation) => [
    commandWords(operation).join(' '),
    `${operation.kind === 'command' ? '✎' : ' '} ${operation.description || operation.id}`,
  ]);
  const width = Math.max(...rows.map(([words]) => words!.length)) + 2;
  return new CliText(
    [
      `Usage: ${program} <command> [--field value ...] [--json <object|->] [--dry-run] [--output json|text]`,
      '',
      'Commands (✎ changes state):',
      ...rows.map(([words, text]) => `  ${words!.padEnd(width)}${firstSentence(text!)}`),
      '',
      `Run "${program} help <command>" for flags. Other verbs: list, schema [command],`,
      'workflows [id], call <operation> <json> [--key key] [--revisions json].',
      'Exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict,',
      '6 idempotency conflict, 7 cancelled, 8 unavailable, 1 internal.',
    ].join('\n'),
  );
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
  if (verb === 'workflows') {
    const id = args[1];
    if (!id)
      return catalog.workflows.map((workflow) => ({
        id: workflow.id,
        operations: workflow.operations,
      }));
    const workflow = catalog.workflows.find((item) => item.id === id);
    if (!workflow) throw new ApplicationError('NOT_FOUND', `Unknown workflow ${id}`);
    return workflow;
  }
  if (verb === 'call') {
    // Original positional form, kept for scripts written against earlier releases.
    const [, id, text, ...flags] = args;
    const definition = catalog.operations.find((item) => item.id === id);
    if (!definition) throw usageError('Unknown operation; use list');
    const key = takeFlag(flags, 'key');
    const revisions = takeFlag(flags, 'revisions');
    if (flags.length) throw usageError('Unknown CLI flag');
    return execute(client, definition, parseJson(text ?? '{}', 'Input'), key, revisions);
  }

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

function execute(
  client: CliClient,
  operation: CatalogOperation,
  input: unknown,
  key: string | undefined,
  revisions: string | undefined,
) {
  return operation.kind === 'query'
    ? client.query(operation.id, input)
    : client.command(operation.id, input, {
        idempotencyKey: key ?? crypto.randomUUID(),
        expectedRevisions:
          revisions === undefined
            ? undefined
            : (parseJson(revisions, '--revisions') as Record<string, number>),
      });
}

/**
 * Validate against the published input schema and the caller's coarse availability without
 * executing. Advisory only: the authority re-validates and authorizes the object at commit time.
 */
function validateOnly(operation: CatalogOperation, input: unknown) {
  const availability = (operation as CatalogOperation & { availability?: string }).availability;
  if (availability === 'denied')
    throw new ApplicationError('FORBIDDEN', `${operation.id} is not available to this caller`);
  const parsed = z.fromJSONSchema(operation.inputSchema as never).safeParse(input);
  if (!parsed.success)
    throw usageError(
      'Input does not match the operation schema',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  return {
    dryRun: true,
    operation: operation.id,
    kind: operation.kind,
    input: input as JsonValue,
    availability: availability ?? 'conditional',
  };
}

/** Render a value for humans. Snapshot and receipt envelopes show their payload. */
export function formatText(value: unknown): string {
  if (value instanceof CliText) return value.text;
  if (value && typeof value === 'object' && 'text' in value && 'operations' in value)
    return String((value as { text: unknown }).text);
  const payload =
    value && typeof value === 'object' && 'cursor' in value
      ? 'data' in value
        ? value.data
        : 'result' in value
          ? value.result
          : value
      : value;
  const scalar = (item: unknown) =>
    item === null || typeof item !== 'object' ? String(item ?? '') : JSON.stringify(item);
  const rows =
    Array.isArray(payload) && payload.every((item) => item && typeof item === 'object')
      ? (payload as Record<string, unknown>[])
      : payload &&
          typeof payload === 'object' &&
          'items' in payload &&
          Array.isArray((payload as { items: unknown }).items)
        ? ((payload as { items: Record<string, unknown>[] }).items ?? [])
        : undefined;
  if (rows) {
    if (!rows.length) return '(none)';
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) =>
      rows.every((row) => row[column] === null || typeof row[column] !== 'object'),
    );
    const cells = [columns, ...rows.map((row) => columns.map((column) => scalar(row[column])))];
    const widths = columns.map((_, index) => Math.max(...cells.map((row) => row[index]!.length)));
    return cells
      .map((row) =>
        row
          .map((cell, index) => cell.padEnd(widths[index]!))
          .join('  ')
          .trimEnd(),
      )
      .join('\n');
  }
  if (payload && typeof payload === 'object')
    return Object.entries(payload)
      .map(([key, item]) => `${key}: ${scalar(item)}`)
      .join('\n');
  return scalar(payload);
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
