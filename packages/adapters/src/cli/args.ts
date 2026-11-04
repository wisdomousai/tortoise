import {
  ApplicationError,
  type Catalog,
  type CatalogOperation,
  type JsonValue,
} from '@tortoise/contracts';
import { commandWords, fieldSpecs, type FieldSpec } from '../cli-syntax';
import type { CliOptions } from './types';

export const usageError = (message: string, details?: JsonValue) =>
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

export function parseJson(text: string, what: string): unknown {
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
export function resolveOperation(catalog: Catalog, words: readonly string[]) {
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
export async function operationInput(
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
