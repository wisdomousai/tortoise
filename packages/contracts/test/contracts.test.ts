import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  canonicalJson,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  type NetworkDestination,
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
    const catalog = buildCatalog([
      defineModule({ id: 'a', capabilities: [command], requirements: { network: [qualityApi] } }),
    ]);
    expect(catalog.operations[0]?.integration).toEqual({
      target: 'quality-system',
      delivery: 'outbox',
    });
    expect(catalog.operations[0]?.destinations).toEqual(['quality-api']);
    expect(
      'integration' in
        buildCatalog([defineModule({ id: 'a', capabilities: [capability('a.b')] })]).operations[0]!,
    ).toBe(false);
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'a',
          capabilities: [{ ...command, kind: 'query' as const }],
          requirements: { network: [qualityApi] },
        }),
      ]),
    ).toThrow('Integration requires a command');
    // An outbox target that travels over no declared destination is undeclared egress.
    expect(() => buildCatalog([defineModule({ id: 'a', capabilities: [command] })])).toThrow(
      'no declared network destination',
    );
  });
});

const qualityApi: NetworkDestination = {
  id: 'quality-api',
  purpose: 'Forward results',
  direction: 'egress',
  scope: 'site',
  protocol: 'https',
  targets: ['quality-system'],
  dataClasses: ['inspection-result'],
  availability: 'required',
  offline: 'queue',
};
const withNetwork = (...network: NetworkDestination[]) =>
  buildCatalog([defineModule({ id: 'a', capabilities: [], requirements: { network } })]);

describe('declared requirements', () => {
  test('modules and host components merge into one sorted manifest with owners', () => {
    const provider = defineHostComponent({
      id: 'provider',
      description: 'Inference provider',
      requirements: {
        network: [
          {
            id: 'provider-api',
            purpose: 'Inference',
            direction: 'egress',
            scope: 'internet',
            protocol: 'https',
            host: 'api.example.com',
            dataClasses: ['prompt'],
            availability: 'optional',
            offline: 'unavailable',
          },
        ],
        processes: [
          {
            id: 'agent-cli',
            executable: 'agent',
            purpose: 'Harness',
            availability: 'optional',
            network: ['provider-api'],
          },
        ],
      },
    });
    const catalog = buildCatalog(
      [defineModule({ id: 'a', capabilities: [], requirements: { network: [qualityApi] } })],
      { components: [provider] },
    );
    expect(catalog.requirements.network.map(({ id, owner }) => [id, owner])).toEqual([
      ['provider-api', 'provider'],
      ['quality-api', 'a'],
    ]);
    expect(catalog.requirements.processes[0]?.owner).toBe('provider');
  });
  test('invalid declarations fail when the catalog is built', () => {
    expect(() => withNetwork(qualityApi, qualityApi)).toThrow('Duplicate network');
    expect(() => withNetwork({ ...qualityApi, id: 'Bad ID' })).toThrow('Invalid network');
    expect(() => withNetwork({ ...qualityApi, dataClasses: [] })).toThrow('data classes');
    expect(() => withNetwork({ ...qualityApi, offline: undefined })).toThrow('offline');
    expect(() => withNetwork({ ...qualityApi, offline: 'degrade' })).toThrow('must queue');
    expect(() => withNetwork({ ...qualityApi, port: 70000 })).toThrow('port');
    expect(() => withNetwork({ ...qualityApi, host: 'https://x/y' })).toThrow('bare host');
    expect(() =>
      withNetwork({ ...qualityApi, targets: [], scope: 'loopback', host: 'example.com' }),
    ).toThrow('non-loopback');
    // Loopback traffic stays on the machine, so it needs no data classes.
    expect(() =>
      withNetwork({ ...qualityApi, targets: [], scope: 'loopback', dataClasses: [] }),
    ).not.toThrow();
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'a',
          capabilities: [],
          requirements: {
            processes: [
              {
                id: 'worker',
                executable: 'w',
                purpose: 'p',
                availability: 'optional',
                network: ['nowhere'],
              },
            ],
          },
        }),
      ]),
    ).toThrow('undeclared destination');
    expect(() =>
      buildCatalog([defineModule({ id: 'a', capabilities: [] })], {
        components: [defineHostComponent({ id: 'a', description: 'clash', requirements: {} })],
      }),
    ).toThrow('share an ID');
  });
  test('audit fields must name top-level input fields', () => {
    const audited = { ...capability('a.audited'), audit: { fields: ['title'] } };
    expect(
      buildCatalog([defineModule({ id: 'a', capabilities: [audited] })]).operations[0]?.audit,
    ).toEqual({ fields: ['title'] });
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'a',
          capabilities: [{ ...audited, audit: { fields: ['secret'] } }],
        }),
      ]),
    ).toThrow('Audit field secret');
  });
});
