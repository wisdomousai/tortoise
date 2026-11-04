import { z } from 'zod';
import { assertJson, canonicalJson, type JsonObject } from './json';

/** One validation issue in the Standard Schema v1 shape; paths address form fields. */
export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}
/**
 * Standard Schema v1 (https://standardschema.dev) so form libraries can validate with the same
 * contract as the runtime. Declared locally: the public contract has no schema-library types.
 */
export interface StandardSchemaProps<T> {
  readonly version: 1;
  readonly vendor: string;
  validate(
    value: unknown,
  ):
    | { readonly value: T; readonly issues?: undefined }
    | { readonly issues: readonly StandardIssue[] };
  readonly types?: { readonly input: T; readonly output: T };
}

/** A JSON-only validator with a portable schema. Executable validation stays out of catalog JSON. */
export interface Schema<T = unknown> {
  readonly jsonSchema: JsonObject;
  parse(value: unknown): T;
  /**
   * Pre-submission validation for UI forms. It applies `parse` rules to the value that would be
   * serialized: keys holding `undefined` are dropped first, exactly as JSON encoding drops them.
   * It never throws for invalid input; the runtime's `parse` remains the authoritative check.
   */
  readonly '~standard': StandardSchemaProps<T>;
}

/** Remove `undefined` object members recursively, mirroring JSON serialization of form state. */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    );
  return value;
}

const portableTypes = [
  'string',
  'number',
  'boolean',
  'null',
  'literal',
  'enum',
  'object',
  'array',
  'union',
  'optional',
  'nullable',
  'record',
  'never',
];

/**
 * Any JSON value. Recursive, so it is the one lazy schema the portability check accepts: JSON
 * Schema carries it exactly as a `$ref`. Use it for opaque JSON such as a requested command input.
 */
export const jsonValueSchema = z.json();

/** Throw on any construct, coercion or refinement whose behavior JSON Schema cannot carry. */
function assertPortable(node: z.ZodType, seen = new Set<object>()): void {
  if (seen.has(node) || node === jsonValueSchema) return;
  seen.add(node);
  const def = node._zod.def as unknown as Record<string, unknown>;
  if (!portableTypes.includes(String(def.type)) || def.coerce)
    throw new TypeError(`Unsupported JSON schema construct: ${String(def.type)}`);
  for (const check of (def.checks ?? []) as { _zod?: { def?: { check?: string } } }[]) {
    if (['custom', 'overwrite'].includes(check._zod?.def?.check ?? ''))
      throw new TypeError('Custom refinements and transforms are not portable JSON schemas');
  }
  for (const value of Object.values(def)) {
    if (value instanceof z.ZodType) assertPortable(value, seen);
    else if (Array.isArray(value))
      for (const child of value) {
        if (child instanceof z.ZodType) assertPortable(child, seen);
      }
    else if (value && typeof value === 'object')
      for (const child of Object.values(value)) {
        if (child instanceof z.ZodType) assertPortable(child, seen);
      }
  }
}

/** Form-side validation with the same rules as `parse`, reporting issues instead of throwing. */
function standardSchema<Z extends z.ZodType>(
  schema: Z,
  parse: (value: unknown) => z.output<Z>,
): StandardSchemaProps<z.output<Z>> {
  return Object.freeze({
    version: 1 as const,
    vendor: 'tortoise',
    validate(value: unknown) {
      const candidate = withoutUndefined(value);
      // Zod's safe parse supplies field paths; the JSON checks below keep parity with `parse`.
      const checked = schema.safeParse(candidate);
      if (!checked.success)
        return {
          issues: checked.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        };
      try {
        return { value: parse(candidate) };
      } catch (error) {
        return {
          issues: [{ message: error instanceof Error ? error.message : 'Invalid value' }],
        };
      }
    },
  });
}

/** Reject authoring constructs whose behavior cannot be represented in JSON Schema. */
export function jsonSchema<Z extends z.ZodType>(schema: Z): Schema<z.output<Z>> {
  assertPortable(schema);
  const exported = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    io: 'output',
  }) as JsonObject;
  assertJson(exported);
  const parse = (value: unknown): z.output<Z> => {
    assertJson(value);
    const result = schema.parse(value);
    assertJson(result);
    if (canonicalJson(value) !== canonicalJson(result))
      throw new TypeError('Schema must validate JSON without stripping or transforming values');
    return result;
  };
  return Object.freeze({ jsonSchema: exported, parse, '~standard': standardSchema(schema, parse) });
}

/**
 * A tool's input schema: the operation's input schema as the `input` property of an envelope,
 * beside transport fields such as `expectedRevisions`. The input schema's `$defs` move to the
 * envelope's root, because its references (`#/$defs/...`) resolve against the root of the
 * document a model server or MCP client receives; left nested, a strict consumer such as
 * llama.cpp's grammar builder refuses the tool.
 */
export function toolEnvelopeSchema(
  inputSchema: JsonObject,
  properties: JsonObject = {},
  required: readonly string[] = ['input'],
): JsonObject {
  const { $defs, $schema: _schema, ...input } = inputSchema;
  return {
    type: 'object',
    additionalProperties: false,
    properties: { input, ...properties },
    required: [...required],
    ...($defs === undefined ? {} : { $defs }),
  };
}

/** `expectedRevisions` as a tool offers it, described so a model fills it only from what it read. */
export const expectedRevisionsSchema: JsonObject = {
  type: 'object',
  description:
    'Optional. Each resource ID you were given a revision for (for example `lot:l1`, as the prompt that started the run names it), mapped to that revision. The command is refused as a conflict when one changed since. Omit it when you were given no revision.',
  additionalProperties: { type: 'integer', minimum: 0 },
};

/**
 * The tool schema an agent harness offers for one operation: the operation's input in the
 * envelope and, for a command, the optional `expectedRevisions`. A query checks no revisions,
 * and `approval.request` creates a record and carries the revisions it rests on in its input
 * (`baseRevisions`), so neither is offered them; models given both fill the wrong one.
 */
export function operationToolSchema(operation: {
  readonly id: string;
  readonly kind: 'command' | 'query';
  readonly inputSchema: JsonObject;
}): JsonObject {
  return operation.kind === 'command' && operation.id !== 'approval.request'
    ? toolEnvelopeSchema(operation.inputSchema, { expectedRevisions: expectedRevisionsSchema })
    : toolEnvelopeSchema(operation.inputSchema);
}
