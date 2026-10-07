import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  assertJson,
  buildCatalog,
  canonicalJson,
  defineCapability,
  defineModule,
  jsonSchema,
} from '../src/index';

const capability = (id: string) =>
  defineCapability({
    id,
    kind: 'command',
    input: jsonSchema(z.strictObject({ title: z.string() })),
    output: jsonSchema(z.string()),
    permission: { action: 'create', resourceType: 'task' },
    ui: { exception: 'headless fixture' },
  });
describe('portable application catalog', () => {
  test('generation is deterministic and serializable across module ordering', () => {
    const a = defineModule({ id: 'a', capabilities: [capability('a.create')] });
    const b = defineModule({ id: 'b', capabilities: [capability('b.create')] });
    expect(canonicalJson(buildCatalog([a, b]))).toBe(canonicalJson(buildCatalog([b, a])));
    expect(buildCatalog([a]).operations[0]?.inputSchema.$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(buildCatalog([a]).operations[0]?.mcpName).toBe('a_create');
  });
  test('duplicate IDs, dependencies, cycles, workflow references and UI omissions fail early', () => {
    const cap = capability('task.create');
    expect(() => buildCatalog([defineModule({ id: 'a', capabilities: [cap, cap] })])).toThrow(
      'Duplicate operation',
    );
    expect(() =>
      buildCatalog([defineModule({ id: 'a', capabilities: [], requires: ['missing'] })]),
    ).toThrow('dependency');
    expect(() =>
      buildCatalog([
        defineModule({ id: 'a', capabilities: [], requires: ['b'] }),
        defineModule({ id: 'b', capabilities: [], requires: ['a'] }),
      ]),
    ).toThrow('cycle');
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'a',
          capabilities: [cap],
          workflows: [{ id: 'w', operations: ['missing'], text: 'fixture' }],
        }),
      ]),
    ).toThrow('unknown operation');
    expect(() =>
      buildCatalog([defineModule({ id: 'a', capabilities: [{ ...cap, ui: undefined }] })]),
    ).toThrow('Missing UI');
  });
  test('lossy MCP mappings never silently overwrite tools', () => {
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'a',
          capabilities: [capability('task.create'), capability('task_create')],
        }),
      ]),
    ).toThrow('MCP name collision');
  });
  test('JSON-only schema helper rejects nonportable constructs', () => {
    expect(() => jsonSchema(z.string().transform((value) => value.length))).toThrow();
    expect(() => jsonSchema(z.string().default('x'))).toThrow();
    expect(() => jsonSchema(z.coerce.number())).toThrow();
    expect(() => jsonSchema(z.string().refine((value) => value !== 'x'))).toThrow();
    expect(() => jsonSchema(z.date())).toThrow();
    expect(() =>
      jsonSchema(z.strictObject({ value: z.number() })).parse({ value: Infinity }),
    ).toThrow();
    expect(() =>
      jsonSchema(z.object({ value: z.string() })).parse({ value: 'x', hidden: true }),
    ).toThrow();
  });
  test('optional fields are supported without altering wire values', () => {
    const schema = jsonSchema(
      z.strictObject({ title: z.string(), restricted: z.string().optional() }),
    );
    expect(schema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(() => schema.parse({ title: 'x', restricted: undefined })).toThrow();
  });
  test('Standard Schema validation matches parse and reports field paths without throwing', () => {
    const schema = jsonSchema(
      z.strictObject({ title: z.string().min(1), note: z.string().optional() }),
    );
    const standard = schema['~standard'];
    expect(standard.version).toBe(1);
    expect(standard.validate({ title: 'x' })).toEqual({ value: { title: 'x' } });
    // Form state may hold undefined for an empty optional field; JSON encoding drops it.
    expect(standard.validate({ title: 'x', note: undefined })).toEqual({ value: { title: 'x' } });
    const invalid = standard.validate({ title: '' });
    expect(invalid.issues?.[0]?.path).toEqual(['title']);
    expect(standard.validate({ title: 'x', extra: 1 }).issues?.length).toBeGreaterThan(0);
    expect(standard.validate({ title: 'x', n: Infinity }).issues?.length).toBeGreaterThan(0);
  });
  test('integration declarations are cataloged only for outbox commands', () => {
    const command = {
      ...capability('result.record'),
      integration: { target: 'quality-system', delivery: 'outbox' as const },
    };
    const catalog = buildCatalog([defineModule({ id: 'a', capabilities: [command] })]);
    expect(catalog.operations[0]?.integration).toEqual({
      target: 'quality-system',
      delivery: 'outbox',
    });
    expect(
      'integration' in
        buildCatalog([defineModule({ id: 'a', capabilities: [capability('a.b')] })]).operations[0]!,
    ).toBe(false);
    expect(() =>
      buildCatalog([
        defineModule({ id: 'a', capabilities: [{ ...command, kind: 'query' as const }] }),
      ]),
    ).toThrow('Integration requires a command');
  });
});

test('sparse arrays are not JSON, so they cannot reload as null', () => {
  expect(() => assertJson(new Array(1))).toThrow('Sparse array at $[0]');
  expect(() => assertJson({ list: [1, , 3] })).toThrow('Sparse array at $.list[1]');
  expect(() => assertJson([null, 1])).not.toThrow();
});
