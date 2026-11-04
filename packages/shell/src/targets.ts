import {
  isWholePlaceholder,
  templatePlaceholders,
  type Catalog,
  type JsonObject,
  type JsonValue,
  type OsDelivery,
  type OsProvenance,
  type OsTarget,
} from '@tortoise/contracts';
import type { OsMatch, OsRequestValues } from './match';
import { OsRequestError } from './parse';

/**
 * Fill a template. A template that is exactly one placeholder yields the raw value, so a blob
 * reference or a number keeps its type; otherwise every placeholder must be text or a number.
 */
export function fillTemplate(template: string, values: OsRequestValues): JsonValue {
  const names = templatePlaceholders(template);
  for (const name of names)
    if (!Object.hasOwn(values, name))
      throw new OsRequestError('invalid', `The request carries no ${name}`);
  if (isWholePlaceholder(template)) return values[names[0]!]!;
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name];
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new OsRequestError('invalid', `${name} cannot be placed in text`);
    return String(value);
  });
}

type Property = {
  type?: string | string[];
  maxLength?: number;
  enum?: JsonValue[];
  anyOf?: Property[];
};

/**
 * A prefilled value checked against its input property: the right JSON type, within
 * `maxLength`, one of `enum`. Text is converted to a number where the property is numeric. The
 * command validates the whole input again when the person submits.
 */
function fitProperty(name: string, value: JsonValue, property: Property | undefined): JsonValue {
  if (!property) throw new OsRequestError('invalid', `${name} is not an input field`);
  const variants = property.anyOf ?? [property];
  const types = new Set(
    variants.flatMap((variant) =>
      Array.isArray(variant.type) ? variant.type : variant.type ? [variant.type] : [],
    ),
  );
  const fits = (candidate: JsonValue) =>
    variants.some(
      (variant) =>
        (!variant.enum || variant.enum.includes(candidate)) &&
        (typeof candidate !== 'string' ||
          variant.maxLength === undefined ||
          candidate.length <= variant.maxLength),
    ) &&
    (types.size === 0 ||
      (typeof candidate === 'string' && types.has('string')) ||
      (typeof candidate === 'number' &&
        (types.has('number') || (types.has('integer') && Number.isInteger(candidate)))) ||
      (typeof candidate === 'boolean' && types.has('boolean')) ||
      (candidate !== null &&
        typeof candidate === 'object' &&
        types.has(Array.isArray(candidate) ? 'array' : 'object')));
  if (fits(value)) return value;
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (Number.isFinite(numeric) && fits(numeric)) return numeric;
  throw new OsRequestError('invalid', `${name} does not fit the form`);
}

function prepareInput(
  catalog: Catalog,
  operation: string,
  input: Readonly<Record<string, string>>,
  values: OsRequestValues,
): JsonObject {
  const schema = catalog.operations.find((item) => item.id === operation)?.inputSchema;
  const properties = (schema?.properties ?? {}) as Record<string, Property>;
  const prepared: JsonObject = {};
  for (const [key, template] of Object.entries(input))
    prepared[key] = fitProperty(
      key,
      fillTemplate(template, values),
      Object.hasOwn(properties, key) ? properties[key] : undefined,
    );
  return prepared;
}

function text(value: JsonValue, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new OsRequestError('invalid', `${field} must be text`);
  return String(value);
}

/**
 * What the frame is asked to show for an accepted request, or the consumer plugin that takes it.
 * Every value comes from the request through the handler's templates, so nothing the sender
 * supplies can name a different resource kind, screen or command.
 */
export function resolveTarget(
  match: OsMatch,
  catalog: Catalog,
): { readonly delivery: OsDelivery } | { readonly consumer: string } {
  const { handler, values } = match;
  if (handler.kind === 'reply') return { consumer: handler.consumer };
  const target: OsTarget = handler.target;
  if ('consumer' in target) return { consumer: target.consumer };
  const provenance: OsProvenance = {
    kind: handler.kind,
    handler: handler.id,
    ...(match.label ? { label: match.label.slice(0, 200) } : {}),
  };
  if ('open' in target) {
    const id = text(fillTemplate(target.id, values), 'id');
    if (!/^[^\s:]{1,128}$/.test(id)) throw new OsRequestError('invalid', 'Not a resource id');
    return { delivery: { type: 'openResource', resource: `${target.open}:${id}`, provenance } };
  }
  if ('screen' in target) {
    const search = Object.fromEntries(
      Object.entries(target.search ?? {}).map(([key, template]) => [
        key,
        text(fillTemplate(template, values), key),
      ]),
    );
    return {
      delivery: {
        type: 'navigate',
        to: target.screen,
        ...(target.search ? { search } : {}),
        provenance,
      },
    };
  }
  return {
    delivery: {
      type: 'prepare',
      operation: target.prepare,
      input: prepareInput(catalog, target.prepare, target.input, values),
      provenance,
    },
  };
}
