import type { AnyCapability, DisplayFieldKind, DisplayTone, JsonObject } from '@tortoise/contracts';

/** The part of a JSON Schema property the generated screens read. */
export type Property = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Property[];
  description?: string;
  properties?: Record<string, Property>;
  required?: string[];
  items?: Property;
};

/** How a field renders in a generated form, table cell or record view. */
export type FieldKind = DisplayFieldKind | 'number' | 'boolean' | 'choice' | 'json';

/** One field of a record as the generated screens show it. */
export interface ShownField {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Status values and their tones, when declared. */
  readonly tones?: Readonly<Record<string, DisplayTone>>;
  /** The resource kind a reference field names. */
  readonly reference?: string;
  /** Choices of an enum field. */
  readonly choices: readonly string[];
  /** The JSON type the value has on the wire (`number` for an epoch date, `string` for ISO). */
  readonly type?: string;
}

/** `createdAt` → `Created at`, `open` → `Open`. */
export const humanize = (name: string) =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

/** The non-null JSON type of a property, the schema that carries it, and whether null is allowed. */
export function propertyTypes(property: Property) {
  // Zod emits `type: ["string", "null"]` for nullable fields; other generators use anyOf.
  const variants = property.anyOf ?? [property];
  const types = variants.flatMap((variant) =>
    Array.isArray(variant.type) ? variant.type : variant.type ? [variant.type] : [],
  );
  const value = variants.find((variant) => variant.type !== 'null') ?? property;
  return { type: types.find((item) => item !== 'null'), nullable: types.includes('null'), value };
}

/** Whether a property is a blob reference: an object with a digest, size and media type. */
export function isBlobProperty(property: Property): boolean {
  const keys = Object.keys(propertyTypes(property).value.properties ?? {});
  return ['digest', 'size', 'mediaType'].every((key) => keys.includes(key));
}

/**
 * The kind of a field the schema does not declare a display kind for. A field named like a
 * timestamp (`createdAt`, `dueDate`, `lastSeen`) whose value is a number or string is a date, a
 * `status` or `state` enum is a status, and a blob reference is a file.
 */
export function inferKind(name: string, property: Property): FieldKind {
  const { type, value } = propertyTypes(property);
  if (isBlobProperty(property)) return 'file';
  if (type === 'string' || type === 'number' || type === 'integer') {
    if (/At$|Time$|Timestamp$|^(lastSeen|seen|since|until|expires)$/.test(name)) return 'date-time';
    if (/Date$|Day$|^(date|day|from|to)$/.test(name) && type === 'string') return 'date';
  }
  if (value.enum)
    return /^(status|state|outcome|sync|result|phase|stage)$/i.test(name) ? 'status' : 'choice';
  if (type === 'string') return 'text';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'json';
}

/** The record schema a get returns, or the item schema of a list's `items`. */
export function recordSchema(schema: JsonObject, list: boolean): Property {
  const properties = (schema.properties ?? {}) as Record<string, Property>;
  return list ? (properties.items?.items ?? {}) : (schema as Property);
}

/** Scalar fields of the record a collection list or get returns, in schema order. */
export function recordFields(schema: JsonObject, list: boolean): string[] {
  return Object.entries(recordSchema(schema, list).properties ?? {})
    .filter(([, property]) => {
      const { type, value } = propertyTypes(property);
      return value.enum !== undefined || (type !== 'object' && type !== 'array');
    })
    .map(([name]) => name);
}

/**
 * The fields a generated screen shows, with their headings and kinds: the capability's display
 * fields, else the schema's scalar fields. A declared kind wins; otherwise the kind is inferred
 * from the field's name and schema.
 */
export function shownFields(
  capability: AnyCapability,
  list: boolean,
  limit?: number,
): ShownField[] {
  const record = recordSchema(capability.output.jsonSchema, list);
  const properties = record.properties ?? {};
  const resolve = (name: string, declared?: Partial<ShownField>): ShownField => {
    const property = properties[name] ?? {};
    const { type, value } = propertyTypes(property);
    const kind = declared?.kind ?? inferKind(name, property);
    return {
      name,
      label: declared?.label ?? humanize(name),
      kind,
      ...(declared?.tones ? { tones: declared.tones } : {}),
      ...(declared?.reference ? { reference: declared.reference } : {}),
      choices: (value.enum ?? []).map(String),
      ...(type ? { type } : {}),
    };
  };
  const display = capability.display;
  if (display?.fields) return display.fields.map((field) => resolve(field.name, field));
  const names = recordFields(capability.output.jsonSchema, list);
  return (limit ? names.slice(0, limit) : names).map((name) => resolve(name));
}

/** The display labels a capability declares, by field name. */
export function displayLabels(capability: AnyCapability): ReadonlyMap<string, string> {
  return new Map(
    (capability.display?.fields ?? []).flatMap((field) =>
      field.label ? [[field.name, field.label] as const] : [],
    ),
  );
}

/** A date value as the record carries it: epoch milliseconds or an ISO string. */
export function toDate(value: unknown): Date | undefined {
  const date =
    typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string' && value
        ? new Date(value)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** A `date` or `datetime-local` input value in local time; undefined when it is not a date. */
export function fromDateInput(raw: string): Date | undefined {
  // `new Date('2026-11-04')` is UTC midnight, which is the previous day west of UTC.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const formats = { date: dateFormat, 'date-time': dateTimeFormat, time: timeFormat };

/** A date, date-time or time of day in the person's locale; the raw value when it is not a date. */
export function formatDate(
  value: unknown,
  kind: 'date' | 'date-time' | 'time' = 'date-time',
): string {
  const date = toDate(value);
  if (!date) return String(value ?? '');
  return formats[kind].format(date);
}

const units = ['B', 'KB', 'MB', 'GB'];
/** A byte count in the nearest unit, for a file cell. */
export function formatBytes(size: number): string {
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * A field value as plain text: a list of scalars joined, a list of records counted, and a record
 * as JSON, never "[object Object]".
 */
export function plainValue(value: unknown): string {
  if (Array.isArray(value))
    return value.every((item) => item === null || typeof item !== 'object')
      ? value.join(', ')
      : `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * The tone of a status value: the declared one, else by the value's wording. A refused, failed
 * or overdue state is negative; a finished or accepted one positive; a waiting one a warning.
 */
export function statusTone(
  value: string,
  tones?: Readonly<Record<string, DisplayTone>>,
): DisplayTone {
  const declared = tones?.[value];
  if (declared) return declared;
  if (tones) return 'neutral';
  const word = value.toLowerCase();
  if (/reject|fail|error|block|overdue|refus|cancel|retired|expired|revoked|denied/.test(word))
    return 'negative';
  if (/accept|done|complete|closed|released|passed|approved|resolved|active|ok|ready/.test(word))
    return 'positive';
  if (/pending|hold|wait|review|due|draft|quarantine|paused|stale/.test(word)) return 'warning';
  return 'neutral';
}

/** The badge variant that shows a tone. */
export const toneVariant = (tone: DisplayTone) =>
  tone === 'negative'
    ? 'destructive'
    : tone === 'positive'
      ? 'secondary'
      : tone === 'warning'
        ? 'default'
        : 'outline';
