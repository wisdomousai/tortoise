import { z } from 'zod';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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

export function assertJson(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertJson(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) assertJson(item, `${path}.${key}`);
    return;
  }
  throw new TypeError(`Non-JSON value at ${path}`);
}

/** Stable JSON serialization is shared by generation and request fingerprints. */
export function canonicalJson(value: unknown): string {
  assertJson(value);
  const sort = (item: JsonValue): JsonValue =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sort(item[key]!)]),
          )
        : item;
  return JSON.stringify(sort(value));
}

/** Reject authoring constructs whose behavior cannot be represented in JSON Schema. */
export function jsonSchema<Z extends z.ZodType>(schema: Z): Schema<z.output<Z>> {
  const visit = (node: z.ZodType, seen = new Set<object>()): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const def = node._zod.def as unknown as Record<string, unknown>;
    const allowed = [
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
    if (!allowed.includes(String(def.type)) || def.coerce)
      throw new TypeError(`Unsupported JSON schema construct: ${String(def.type)}`);
    for (const check of (def.checks ?? []) as { _zod?: { def?: { check?: string } } }[]) {
      if (['custom', 'overwrite'].includes(check._zod?.def?.check ?? ''))
        throw new TypeError('Custom refinements and transforms are not portable JSON schemas');
    }
    for (const value of Object.values(def)) {
      if (value instanceof z.ZodType) visit(value, seen);
      else if (Array.isArray(value))
        for (const child of value) {
          if (child instanceof z.ZodType) visit(child, seen);
        }
      else if (value && typeof value === 'object')
        for (const child of Object.values(value)) {
          if (child instanceof z.ZodType) visit(child, seen);
        }
    }
  };
  visit(schema);
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
  return Object.freeze({
    jsonSchema: exported,
    parse,
    '~standard': Object.freeze({
      version: 1 as const,
      vendor: 'agent-native',
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
    }),
  });
}

export interface PermissionRequirement {
  readonly action: string;
  readonly resourceType: string;
  readonly fields?: readonly string[];
}
/**
 * Declares that a command's committed result is forwarded to an external system of record through
 * the transactional outbox. A receipt proves the local commit only; acceptance by `target` arrives
 * later through a settlement command and may be a rejection.
 */
export interface IntegrationDeclaration {
  readonly target: string;
  readonly delivery: 'outbox';
}
export interface Capability<
  Id extends string = string,
  Kind extends 'command' | 'query' = 'command' | 'query',
  Input = unknown,
  Output = unknown,
> {
  readonly id: Id;
  readonly kind: Kind;
  readonly input: Schema<Input>;
  readonly output: Schema<Output>;
  readonly description?: string;
  readonly permission: PermissionRequirement;
  readonly dependencies?: readonly string[];
  readonly ui?: { readonly binding?: string; readonly exception?: string };
  readonly errors?: readonly string[];
  readonly integration?: IntegrationDeclaration;
}
export type AnyCapability = Capability<string, 'command' | 'query', unknown, unknown>;
export type InputOf<C> =
  C extends Capability<string, 'command' | 'query', infer I, unknown> ? I : never;
export type OutputOf<C> =
  C extends Capability<string, 'command' | 'query', unknown, infer O> ? O : never;
export function defineCapability<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I,
  O,
>(capability: Capability<Id, Kind, I, O>): Capability<Id, Kind, I, O> {
  return Object.freeze(capability);
}
export interface CapabilityModule<C extends readonly AnyCapability[] = readonly AnyCapability[]> {
  readonly id: string;
  readonly capabilities: C;
  readonly requires?: readonly string[];
  readonly workflows?: readonly {
    readonly id: string;
    readonly operations: readonly string[];
    readonly text: string;
  }[];
}
export function defineModule<const C extends readonly AnyCapability[]>(
  module: CapabilityModule<C>,
): CapabilityModule<C> {
  return Object.freeze(module);
}
export type CapabilitiesOf<M extends readonly CapabilityModule[]> =
  M[number]['capabilities'][number];
export type CapabilityById<C extends AnyCapability, Id extends C['id']> = Extract<C, { id: Id }>;

export interface CatalogOperation {
  readonly id: string;
  readonly kind: 'command' | 'query';
  readonly module: string;
  readonly mcpName: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly permission: PermissionRequirement;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly errors: readonly string[];
  readonly ui: { readonly binding?: string; readonly exception?: string };
  readonly integration?: IntegrationDeclaration;
}
export interface Catalog {
  readonly formatVersion: 1;
  readonly operations: readonly CatalogOperation[];
  readonly workflows: readonly {
    readonly id: string;
    readonly operations: readonly string[];
    readonly text: string;
  }[];
}

/** Generators consume this pure representation, never application handlers or host services. */
export function buildCatalog(modules: readonly CapabilityModule[]): Catalog {
  const moduleIds = new Set<string>();
  const ids = new Set<string>();
  const mcpNames = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    moduleIds.add(module.id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byModule = new Map(modules.map((module) => [module.id, module]));
  const checkDependencies = (id: string): void => {
    if (visiting.has(id))
      throw new Error(`Module dependency cycle: ${[...visiting, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const module = byModule.get(id);
    if (!module) throw new Error(`Missing module dependency: ${id}`);
    visiting.add(id);
    for (const dependency of module.requires ?? []) checkDependencies(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of moduleIds) checkDependencies(id);
  const operations: CatalogOperation[] = [];
  for (const module of modules) {
    for (const required of module.requires ?? [])
      if (!moduleIds.has(required))
        throw new Error(`Module ${module.id} requires missing module ${required}`);
    for (const capability of module.capabilities) {
      if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(capability.id))
        throw new Error(`Invalid operation ID: ${capability.id}`);
      if (ids.has(capability.id)) throw new Error(`Duplicate operation: ${capability.id}`);
      ids.add(capability.id);
      const mcpName = capability.id.replace(/[.-]/g, '_');
      if (mcpName.length > 64 || mcpNames.has(mcpName))
        throw new Error(`MCP name collision or excessive length: ${capability.id} -> ${mcpName}`);
      mcpNames.add(mcpName);
      if (!capability.ui?.binding && !capability.ui?.exception)
        throw new Error(`Missing UI binding or exception: ${capability.id}`);
      if (
        capability.integration &&
        (capability.kind !== 'command' ||
          !capability.integration.target ||
          capability.integration.delivery !== 'outbox')
      )
        throw new Error(`Integration requires a command with an outbox target: ${capability.id}`);
      operations.push({
        id: capability.id,
        kind: capability.kind,
        module: module.id,
        mcpName,
        inputSchema: capability.input.jsonSchema,
        outputSchema: capability.output.jsonSchema,
        permission: capability.permission,
        description: capability.description ?? '',
        dependencies: capability.dependencies ?? [],
        errors: capability.errors ?? [],
        ui: capability.ui,
        // Omitted rather than undefined: the catalog is canonical JSON.
        ...(capability.integration ? { integration: capability.integration } : {}),
      });
    }
  }
  const workflowIds = new Set<string>();
  const workflows = modules
    .flatMap((module) => module.workflows ?? [])
    .map((workflow) => {
      if (workflowIds.has(workflow.id)) throw new Error(`Duplicate workflow: ${workflow.id}`);
      workflowIds.add(workflow.id);
      for (const id of workflow.operations)
        if (!ids.has(id))
          throw new Error(`Workflow ${workflow.id} references unknown operation ${id}`);
      return workflow;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const catalog: Catalog = {
    formatVersion: 1,
    operations: operations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    workflows,
  };
  // Copy metadata so later application mutations cannot silently alter a built catalog.
  return JSON.parse(canonicalJson(catalog)) as Catalog;
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CANCELLED'
  | 'INTERNAL';
export class ApplicationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: JsonValue;
}
export function errorEnvelope(error: unknown): ErrorEnvelope {
  return error instanceof ApplicationError
    ? {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      }
    : { code: 'INTERNAL', message: 'Application execution failed' };
}
