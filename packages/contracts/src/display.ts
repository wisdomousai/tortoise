import type { JsonObject } from './json';

/**
 * How a generic screen renders a field. Without one, a screen infers: a number named `…At` is
 * a date and time, a field named `status` or `sync` is a status, a blob reference is a file,
 * and anything else is text.
 */
export type DisplayFieldKind =
  | 'text'
  /** A calendar day: a number of milliseconds since the epoch, or a `YYYY-MM-DD` string. */
  | 'date'
  /** A point in time: a number of milliseconds since the epoch, or an ISO 8601 string. */
  | 'date-time'
  /** A short state word shown as a badge, toned by `tones`. */
  | 'status'
  /** The key of a record in another collection, named by `reference`. */
  | 'reference'
  /** A blob reference, or a list of them. */
  | 'file';

/** How a status value reads: neutral by default. */
export type DisplayTone = 'neutral' | 'positive' | 'warning' | 'negative';

/** One output field as a screen or an agent shows it. */
export interface DisplayField {
  readonly name: string;
  /** Column or row heading; the field name in words when omitted. */
  readonly label?: string;
  readonly kind?: DisplayFieldKind;
  /** For a `status` field: the tone of each value a screen should colour. */
  readonly tones?: Readonly<Record<string, DisplayTone>>;
  /**
   * For a `reference` field: the resource kind of the collection the key points into. A form
   * offers a picker over that collection's list, and a screen shows the record's title.
   */
  readonly reference?: string;
}

/**
 * How a capability and its result are presented, to a person on a generic screen and to an
 * agent in its tool list. Data only: it carries no behavior, and a capability without it is
 * shown from its schema. Field names refer to the record the output holds: the output itself,
 * or the item of an `items` array, as a list or search returns.
 */
export interface DisplayDeclaration {
  /** The operation's name in menus, buttons and the MCP tool title. */
  readonly label?: string;
  /**
   * The resource kind each record names, such as `note`. A screen links the record to the
   * screen of `<kind>:<key>`, and an agent can open it. The application must list the kind in
   * `selectableResources`.
   */
  readonly resource?: string;
  /** The field that holds the record's key in `resource`; `id` when omitted. */
  readonly key?: string;
  /** The field that names a record. */
  readonly titleField?: string;
  /** The fields to show, in order. */
  readonly fields?: readonly DisplayField[];
}

/** The record schema an output holds: the item of an `items` array, or the output itself. */
export function displayRecord(output: JsonObject): JsonObject {
  const items = (output.properties as Record<string, JsonObject> | undefined)?.items;
  return items?.type === 'array' && items.items && typeof items.items === 'object'
    ? (items.items as JsonObject)
    : output;
}

const kind = /^[a-z][a-z0-9-]*$/;
const fieldKinds = new Set<DisplayFieldKind>([
  'text',
  'date',
  'date-time',
  'status',
  'reference',
  'file',
]);
const tones = new Set<DisplayTone>(['neutral', 'positive', 'warning', 'negative']);
const label = (text: string) => text.trim().length > 0 && text.length <= 80 && !/[\r\n]/.test(text);

/**
 * Reject a display declaration that names a field the output record does not have, repeats a
 * field, or has an empty or multi-line label. The catalog build calls it for every capability.
 */
export function checkDisplay(
  id: string,
  display: DisplayDeclaration | undefined,
  output: JsonObject,
): void {
  if (!display) return;
  const properties = Object.keys((displayRecord(output).properties as JsonObject) ?? {});
  const field = (name: string, role: string) => {
    if (!properties.includes(name))
      throw new Error(`Display ${role} ${name} is not a field of the output record: ${id}`);
  };
  if (display.label !== undefined && !label(display.label))
    throw new Error(`Display label must be one line of at most 80 characters: ${id}`);
  if (display.resource !== undefined) {
    if (!kind.test(display.resource))
      throw new Error(`Display resource must be a resource kind: ${id}`);
    field(display.key ?? 'id', 'key');
  } else if (display.key !== undefined) throw new Error(`Display key needs a resource: ${id}`);
  if (display.titleField !== undefined) field(display.titleField, 'title field');
  if (display.fields) {
    if (display.fields.length === 0) throw new Error(`Display fields must not be empty: ${id}`);
    const seen = new Set<string>();
    for (const entry of display.fields) {
      field(entry.name, 'field');
      if (seen.has(entry.name)) throw new Error(`Display field ${entry.name} repeats: ${id}`);
      seen.add(entry.name);
      if (entry.label !== undefined && !label(entry.label))
        throw new Error(`Display label of ${entry.name} must be one short line: ${id}`);
      if (entry.kind !== undefined && !fieldKinds.has(entry.kind))
        throw new Error(`Display kind of ${entry.name} is unknown: ${id}`);
      if (entry.tones) {
        if (entry.kind !== undefined && entry.kind !== 'status')
          throw new Error(`Display tones need a status field: ${entry.name} in ${id}`);
        for (const tone of Object.values(entry.tones))
          if (!tones.has(tone)) throw new Error(`Display tone of ${entry.name} is unknown: ${id}`);
      }
      if (entry.reference !== undefined) {
        if (entry.kind !== undefined && entry.kind !== 'reference')
          throw new Error(`Display reference needs a reference field: ${entry.name} in ${id}`);
        if (!kind.test(entry.reference))
          throw new Error(`Display reference of ${entry.name} must be a resource kind: ${id}`);
      } else if (entry.kind === 'reference')
        throw new Error(`Display reference field ${entry.name} names no collection: ${id}`);
    }
  }
}
