import { expect, test } from 'bun:test';
import {
  operationToolSchema,
  proposalOperations,
  toolEnvelopeSchema,
  type JsonObject,
} from '../src/index';

/** Every `$ref` in `schema`, resolved as a model server resolves it: from the document's root. */
function unresolved(schema: JsonObject): string[] {
  const missing: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const ref = (node as { $ref?: unknown }).$ref;
    if (typeof ref === 'string') {
      const target = ref
        .slice(2)
        .split('/')
        .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], schema);
      if (target === undefined) missing.push(ref);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return missing;
}

test("a recursive input schema's references resolve once it is wrapped in a tool envelope", () => {
  const input = proposalOperations.proposalSubmit.input.jsonSchema;
  // The proposed input is any JSON value, a recursive schema with its own definitions.
  expect(Object.keys(input)).toContain('$defs');
  const nested = { type: 'object', properties: { input } } as JsonObject;
  expect(unresolved(nested).length).toBeGreaterThan(0);

  const envelope = toolEnvelopeSchema(input, { expectedRevisions: { type: 'object' } });
  expect(unresolved(envelope)).toEqual([]);
  expect(envelope).toMatchObject({
    type: 'object',
    additionalProperties: false,
    required: ['input'],
    properties: { input: { type: 'object' }, expectedRevisions: { type: 'object' } },
  });
  expect((envelope.properties as JsonObject).input).not.toHaveProperty('$defs');
});

test('a command tool offers expectedRevisions with a description; a query and proposal.submit do not', () => {
  const input = { type: 'object', properties: { id: { type: 'string' } } } as JsonObject;
  const command = operationToolSchema({ id: 'lot.release', kind: 'command', inputSchema: input });
  const query = operationToolSchema({ id: 'lot.get', kind: 'query', inputSchema: input });
  expect((command.properties as JsonObject).expectedRevisions).toMatchObject({
    type: 'object',
    description: expect.stringContaining('resource ID'),
  });
  expect(Object.keys(query.properties as JsonObject)).toEqual(['input']);
  const submit = operationToolSchema({
    id: 'proposal.submit',
    kind: 'command',
    inputSchema: proposalOperations.proposalSubmit.input.jsonSchema,
  });
  expect(Object.keys(submit.properties as JsonObject)).toEqual(['input']);
});
