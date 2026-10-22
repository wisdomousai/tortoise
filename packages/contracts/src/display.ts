import type { JsonObject } from './json';

/** One output field as a screen or an agent shows it. */
export interface DisplayField {
  readonly name: string;
  /** Column or row heading; the field name in words when omitted. */
  readonly label?: string;
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
    }
  }
}
