import type { CatalogOperation, JsonObject } from '@agent-native/contracts';

/**
 * Pure command-line syntax derived from the catalog. It performs no IO, so documentation
 * generators can describe the CLI without loading transports or opening a workspace.
 */

export interface FieldSpec {
  readonly property: string;
  readonly flag: string;
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'json';
  readonly required: boolean;
  readonly nullable: boolean;
  readonly choices: readonly string[];
  readonly description?: string;
}

type Property = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Property[];
  description?: string;
};

/** `inspection.plant.set-member` is invoked as `inspection plant set-member`. */
export const commandWords = (operation: Pick<CatalogOperation, 'id'>) => operation.id.split('.');

/** `characteristicId` is passed as `--characteristic-id`. */
export const flagName = (property: string) =>
  property.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Top-level input properties as flags. Nested objects and arrays take a JSON value. */
export function fieldSpecs(schema: JsonObject): FieldSpec[] {
  const properties = (schema.properties ?? {}) as Record<string, Property>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([property, definition]) => {
    // Zod emits `type: ["string", "null"]` for nullable fields; other generators use anyOf.
    const variants = definition.anyOf ?? [definition];
    const types = variants.flatMap((variant) =>
      Array.isArray(variant.type) ? variant.type : [variant.type],
    );
    const value = variants.find((variant) => variant.type !== 'null') ?? definition;
    const declared = types.find((type) => type !== 'null');
    const type: FieldSpec['type'] =
      declared === 'string' ||
      declared === 'number' ||
      declared === 'integer' ||
      declared === 'boolean'
        ? declared
        : 'json';
    return {
      property,
      flag: flagName(property),
      type,
      required: required.has(property),
      nullable: types.includes('null'),
      choices: (value.enum ?? []).map(String),
      ...(definition.description || value.description
        ? { description: definition.description ?? value.description }
        : {}),
    };
  });
}

const placeholder = (field: FieldSpec) =>
  field.choices.length ? field.choices.join('|') : field.type === 'json' ? 'json' : field.type;

/** One-line synopsis such as `app inspection lot get --id <string>`; optional flags are bracketed. */
export function synopsis(operation: CatalogOperation, program: string): string {
  const flags = fieldSpecs(operation.inputSchema).map((field) => {
    const flag = `--${field.flag} <${placeholder(field)}>`;
    return field.required ? flag : `[${flag}]`;
  });
  const transport = operation.kind === 'command' ? ['[--key <idempotency-key>]'] : [];
  return [program, ...commandWords(operation), ...flags, ...transport].join(' ');
}
