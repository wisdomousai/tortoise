import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApplicationError,
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type Catalog,
} from '@agent-native/contracts';
import { CliText, exitCodes, formatText, runCli, runCliMain, type CliClient } from './cli';
import { synopsis } from './cli-syntax';
import { readGrantFile } from './direct';

const permission = { action: 'Update', resourceType: 'lot' } as const;
const module = defineModule({
  id: 'qa',
  capabilities: [
    defineCapability({
      id: 'qa.result.record',
      kind: 'command',
      description: 'Record a value. Second sentence.',
      input: jsonSchema(
        z.strictObject({
          lotId: z.string().min(1),
          sample: z.number().int().min(1).optional(),
          value: z.number(),
          final: z.boolean().optional(),
          note: z.string().nullable().optional(),
          capture: z.strictObject({ input: z.enum(['keyboard', 'scanner']) }).optional(),
        }),
      ),
      output: jsonSchema(z.strictObject({ id: z.string() })),
      permission,
      ui: { binding: 'test' },
    }),
    defineCapability({
      id: 'qa.lot.list',
      kind: 'query',
      description: 'List lots.',
      input: jsonSchema(z.strictObject({ status: z.enum(['open', 'closed']).optional() })),
      output: jsonSchema(z.strictObject({ items: z.array(z.strictObject({ id: z.string() })) })),
      permission: { action: 'Read', resourceType: 'lot' },
      ui: { binding: 'test' },
    }),
  ],
  workflows: [{ id: 'inspect', operations: ['qa.lot.list'], text: '# Inspect\n\nSteps.' }],
});

/** Records what the CLI would send; the authority itself is out of scope for parsing tests. */
function fakeClient(catalog: Catalog = buildCatalog([module])) {
  const calls: { kind: string; operation: string; input: unknown; options?: unknown }[] = [];
  const client: CliClient = {
    catalog: async () => catalog,
    async query(operation, input) {
      calls.push({ kind: 'query', operation, input });
      return { data: { items: [{ id: 'L1' }] } as never, cursor: '1', authorizationRevision: 1 };
    },
    async command(operation, input, options) {
      calls.push({ kind: 'command', operation, input, options });
      return {
        operation,
        result: { id: 'r1' } as never,
        cursor: '2',
        authorizationRevision: 1,
        revisions: {},
      };
    },
    events: () => {
      throw new Error('unused');
    },
  };
  return { client, calls };
}

const error = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected failure');
    },
    (failure: ApplicationError) => failure,
  );

describe('catalog command line', () => {
  test('words select the operation and flags become typed input', async () => {
    const { client, calls } = fakeClient();
    await runCli(
      [
        'qa',
        'result',
        'record',
        '--lot-id',
        'L1',
        '--sample=2',
        '--value',
        '-0.5',
        '--final',
        '--note',
        'null',
        '--capture',
        '{"input":"scanner"}',
        '--key',
        'k-1',
        '--revisions',
        '{"lot:L1":3}',
      ],
      client,
    );
    expect(calls).toEqual([
      {
        kind: 'command',
        operation: 'qa.result.record',
        input: {
          lotId: 'L1',
          sample: 2,
          value: -0.5,
          final: true,
          note: null,
          capture: { input: 'scanner' },
        },
        options: { idempotencyKey: 'k-1', expectedRevisions: { 'lot:L1': 3 } },
      },
    ]);
    // The dotted identifier with flags or with --json reaches the same operation.
    await runCli(['qa.lot.list', '--status', 'open'], client);
    await runCli(['qa.lot.list', '--json', '{"status":"closed"}'], client);
    expect(calls.slice(1).map((call) => call.input)).toEqual([
      { status: 'open' },
      { status: 'closed' },
    ]);
  });

  test('--json supplies whole input from an argument or explicit stdin; flags override it', async () => {
    const { client, calls } = fakeClient();
    await runCli(['qa', 'result', 'record', '--json', '-', '--value', '2'], client, {
      readStdin: async () => '{"lotId":"L9","value":1}',
    });
    expect(calls[0]!.input).toEqual({ lotId: 'L9', value: 2 });
    expect((await error(runCli(['qa', 'lot', 'list', '--json', '{'], client))).message).toBe(
      '--json must be valid JSON',
    );
  });

  test('malformed arguments fail as INVALID_INPUT before reaching the authority', async () => {
    const { client, calls } = fakeClient();
    for (const args of [
      ['qa', 'result', 'record', '--sample', '1.5'],
      ['qa', 'result', 'record', '--value', 'abc'],
      ['qa', 'result', 'record', '--final', 'yes'],
      ['qa', 'result', 'record', '--lot-id'],
      ['qa', 'result', 'record', '--unknown', '1'],
      ['qa', 'result', 'record', '--value', '1', '--value', '2'],
      ['qa', 'lot', 'list', '--key', 'k'],
      ['qa', 'lot', 'list', 'extra'],
      ['qa', 'result'],
      ['nope'],
    ]) {
      const failure = await error(runCli(args, client));
      expect(failure).toBeInstanceOf(ApplicationError);
      expect(failure.code).toBe('INVALID_INPUT');
    }
    expect(
      (await error(runCli(['qa', 'result'], client))).details as Record<string, unknown>,
    ).toEqual({ candidates: ['qa result record'] });
    expect(calls).toEqual([]);
  });

  test('--dry-run validates against the schema and availability without executing', async () => {
    const { client, calls } = fakeClient();
    expect(
      await runCli(
        ['qa', 'result', 'record', '--lot-id', 'L1', '--value', '1', '--dry-run'],
        client,
      ),
    ).toEqual({
      dryRun: true,
      operation: 'qa.result.record',
      kind: 'command',
      input: { lotId: 'L1', value: 1 },
      availability: 'conditional',
    });
    const invalid = await error(runCli(['qa', 'result', 'record', '--dry-run'], client));
    expect(invalid.code).toBe('INVALID_INPUT');
    expect(invalid.details).toEqual([
      { path: 'lotId', message: expect.any(String) },
      { path: 'value', message: expect.any(String) },
    ]);
    const catalog = buildCatalog([module]);
    const denied = fakeClient({
      ...catalog,
      operations: catalog.operations.map((operation) => ({ ...operation, availability: 'denied' })),
    });
    expect((await error(runCli(['qa', 'lot', 'list', '--dry-run'], denied.client))).code).toBe(
      'FORBIDDEN',
    );
    expect(calls).toEqual([]);
  });

  test('help is generated from the catalog; text output renders payloads', async () => {
    const { client } = fakeClient();
    const overview = (await runCli(['help'], client, { program: 'qi' })) as CliText;
    expect(overview.text).toContain('qa result record');
    expect(overview.text).toContain('✎ Record a value.');
    expect(overview.text).not.toContain('Second sentence');
    const help = (await runCli(['qa', 'result', 'record', '--help'], client, {
      program: 'qi',
    })) as CliText;
    expect(help.text.split('\n')[0]).toBe(
      'qi qa result record [--capture <json>] [--final <boolean>] --lot-id <string> [--note <string>] [--sample <integer>] --value <number> [--key <idempotency-key>]',
    );
    const list = buildCatalog([module]).operations.find(
      (operation) => operation.id === 'qa.lot.list',
    );
    expect(synopsis(list!, 'qi')).toBe('qi qa lot list [--status <open|closed>]');
    expect(formatText(await runCli(['qa', 'lot', 'list'], client))).toBe('id\nL1');
    expect(formatText(await runCli(['workflows', 'inspect'], client))).toBe('# Inspect\n\nSteps.');
    expect(await runCli(['workflows'], client)).toEqual([
      { id: 'inspect', operations: ['qa.lot.list'] },
    ]);
  });

  test('exit status is mapped from the error code, with one JSON envelope on stdout', async () => {
    const { client } = fakeClient();
    const denying: CliClient = {
      ...client,
      query: async () => {
        throw new ApplicationError('FORBIDDEN', 'No role at plant');
      },
    };
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => void lines.push(line);
    try {
      expect(await runCliMain(['qa', 'lot', 'list'], denying)).toBe(exitCodes.FORBIDDEN);
      expect(await runCliMain(['qa', 'lot', 'list', '--output', 'text'], denying)).toBe(4);
      expect(await runCliMain(['qa', 'lot', 'list', '--output', 'xml'], client)).toBe(2);
      expect(
        await runCliMain(['qa', 'lot', 'list'], async () => {
          throw new Error('secret endpoint detail');
        }),
      ).toBe(1);
      expect(await runCliMain(['qa', 'lot', 'list', '--output', 'text'], client)).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines).toEqual([
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No role at plant' } }),
      'FORBIDDEN: No role at plant',
      JSON.stringify({
        error: { code: 'INVALID_INPUT', message: '--output must be json or text' },
      }),
      JSON.stringify({ error: { code: 'INTERNAL', message: 'Application execution failed' } }),
      'id\nL1',
    ]);
  });
});

describe('launcher grant files', () => {
  test('grant files fix a narrowed context and fail closed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-grant-'));
    const file = join(directory, 'grant.json');
    const read = async (value: unknown) => {
      await writeFile(file, JSON.stringify(value));
      return readGrantFile(file, 'local');
    };
    try {
      expect(await read({ principalId: 'ina', operations: ['qa.lot.list'] })).toEqual({
        workspaceId: 'local',
        principalId: 'ina',
        grant: { operations: ['qa.lot.list'], principalId: 'ina', workspaceId: 'local' },
      });
      for (const invalid of [
        { operations: ['qa.lot.list'] },
        { principalId: 'ina', operations: [] },
        { principalId: 'ina', operations: ['qa.lot.list'], workspaceId: 'other' },
        { principalId: 'ina', operations: ['qa.lot.list'], runId: 'forged' },
        { principalId: 'ina', operations: ['qa.lot.list'], expiresAt: 'tomorrow' },
      ])
        expect((await error(read(invalid))).code).toBe('INVALID_INPUT');
      expect(
        (await error(read({ principalId: 'ina', operations: ['qa.lot.list'], expiresAt: 1 }))).code,
      ).toBe('FORBIDDEN');
      expect((await error(readGrantFile(join(directory, 'missing'), 'local'))).code).toBe(
        'INVALID_INPUT',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
