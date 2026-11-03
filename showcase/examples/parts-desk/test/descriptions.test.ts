import { expect, test } from 'bun:test';
import { partsDeskModule } from '../contracts';

/** The longest description a model reads for one capability or input property. */
const MAX_DESCRIPTION = 399;

type JsonSchema = {
  description?: unknown;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
  $defs?: Record<string, JsonSchema>;
};

/** A missing, empty or overlong description at `path`, or nothing. */
function problem(path: string, description: unknown): string[] {
  if (typeof description !== 'string' || description.trim() === '')
    return [`${path}: no description`];
  if (description.length > MAX_DESCRIPTION) return [`${path}: ${description.length} characters`];
  return [];
}

/**
 * Every property of the schema at any depth: object properties, array items such as a quote's
 * lines, the members of a union and shared definitions. A property's description is what a model
 * reads, so each one needs its own.
 */
function propertyProblems(schema: JsonSchema, path: string): string[] {
  const found: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {}))
    found.push(
      ...problem(`${path}.${name}`, property.description),
      ...propertyProblems(property, `${path}.${name}`),
    );
  const items = Array.isArray(schema.items) ? schema.items : schema.items ? [schema.items] : [];
  for (const item of items) found.push(...propertyProblems(item, `${path}[]`));
  for (const member of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])])
    found.push(...propertyProblems(member, path));
  if (typeof schema.additionalProperties === 'object')
    found.push(...propertyProblems(schema.additionalProperties, `${path}{}`));
  for (const [name, definition] of Object.entries(schema.$defs ?? {}))
    found.push(...propertyProblems(definition, `${path}.$defs.${name}`));
  return found;
}

// The application's own operations. Plugins and features describe theirs in their own packages.
test('every capability and every input property of the application has a description', () => {
  expect(partsDeskModule.capabilities.length).toBeGreaterThan(0);
  const problems = partsDeskModule.capabilities.flatMap((capability) => [
    ...problem(capability.id, capability.description),
    ...propertyProblems(capability.input.jsonSchema as JsonSchema, `${capability.id} input`),
  ]);
  expect(problems).toEqual([]);
});

test('the check finds a property without a description at any depth', () => {
  expect(
    propertyProblems(
      {
        properties: {
          lines: {
            description: 'Lines.',
            items: { properties: { partNumber: {}, quantity: { description: 'x'.repeat(400) } } },
          },
        },
      },
      'quote.create input',
    ),
  ).toEqual([
    'quote.create input.lines[].partNumber: no description',
    'quote.create input.lines[].quantity: 400 characters',
  ]);
});
