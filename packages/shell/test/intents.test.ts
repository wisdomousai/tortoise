import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type OsAction,
  type OsHandler,
} from '@tortoise/contracts';
import {
  buildInstruction,
  intentListening,
  intentRequest,
  intentToStart,
  matchOsRequest,
  nativeOsConfig,
  parseRawOsRequest,
} from '../src/index';

const create = defineCapability({
  id: 'note.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string().optional(), body: z.string().optional() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'create', resourceType: 'note' },
  ui: { binding: 'note.create' },
});
const handlers: OsHandler[] = [
  {
    id: 'note.from-pdf-intent',
    kind: 'intent',
    description: 'A note for a PDF another app hands over.',
    action: 'dev.example.notes.action.ATTACH',
    categories: ['dev.example.notes.category.PRINT'],
    data: { scheme: 'content', mimeType: 'application/pdf' },
    target: { prepare: 'note.create', input: { body: '{data}' } },
  },
  {
    id: 'note.from-intent',
    kind: 'intent',
    description: 'A note another app asks for.',
    action: 'dev.example.notes.action.CREATE',
    extras: jsonSchema(z.strictObject({ title: z.string().max(10), rank: z.number().int() })),
    target: { prepare: 'note.create', input: { title: '{title}' } },
  },
];
const action: OsAction = {
  id: 'note.print',
  kind: 'intent',
  description: 'Print a note.',
  action: 'com.example.print.action.PRINT',
  package: 'com.example.print',
  extras: jsonSchema(z.strictObject({ copies: z.number().int().max(3) })),
  dataClasses: ['note-title'],
};
const os = buildCatalog([
  defineModule({ id: 'notes', capabilities: [create], os: { handlers, actions: [action] } }),
]).os!;
const match = (value: unknown) =>
  matchOsRequest(handlers, parseRawOsRequest(value), { schemes: [], linkHosts: [] });

test('an intent matches by action, categories, data scheme and type, then its extras schema', () => {
  const pdf = {
    kind: 'intent',
    action: 'dev.example.notes.action.ATTACH',
    categories: ['dev.example.notes.category.PRINT', 'android.intent.category.DEFAULT'],
    data: 'content://downloads/7',
    mimeType: 'application/pdf',
  };
  expect(match(pdf)).toMatchObject({
    handler: { id: 'note.from-pdf-intent' },
    values: { data: 'content://downloads/7' },
  });
  expect(match({ ...pdf, categories: [] })).toBeUndefined();
  expect(match({ ...pdf, data: 'https://example.com/7' })).toBeUndefined();
  expect(match({ ...pdf, mimeType: 'text/plain' })).toBeUndefined();
  expect(
    match({
      kind: 'intent',
      action: 'dev.example.notes.action.CREATE',
      extras: { title: 'Milk', rank: 2 },
    }),
  ).toMatchObject({ values: { title: 'Milk', rank: 2 } });
  for (const extras of [{ title: 'Milk', rank: 1.5 }, { title: 'x'.repeat(11), rank: 1 }, {}])
    expect(() =>
      match({ kind: 'intent', action: 'dev.example.notes.action.CREATE', extras }),
    ).toThrow();
});

test('the device listens for the declared actions and their typed extras only', () => {
  const listening = intentListening(os);
  expect(listening).toEqual({
    'dev.example.notes.action.ATTACH': {},
    'dev.example.notes.action.CREATE': { title: 'string', rank: 'number' },
  });
  expect(
    intentRequest(
      { action: 'dev.example.notes.action.CREATE', data: null, extras: { title: 'Milk' } },
      listening,
    ),
  ).toEqual({
    kind: 'intent',
    action: 'dev.example.notes.action.CREATE',
    extras: { title: 'Milk' },
  });
  expect(intentRequest({ action: 'android.intent.action.MAIN' }, listening)).toBeUndefined();
  expect(intentRequest({ action: 'toString' }, listening)).toBeUndefined();
  expect(
    intentRequest({ action: 'dev.example.notes.action.CREATE', categories: 'x' }, listening),
  ).toBeUndefined();
  expect(intentRequest(['dev.example.notes.action.CREATE'], listening)).toBeUndefined();
});

test('an intent action is built from its declaration and checked again before it starts', () => {
  const instruction = buildInstruction(action, { copies: 2 }, () => undefined);
  expect(instruction).toEqual({
    kind: 'intent',
    action: 'note.print',
    intent: 'com.example.print.action.PRINT',
    package: 'com.example.print',
    extras: { copies: 2 },
  });
  expect(() => buildInstruction(action, { copies: 2, extra: 1 }, () => undefined)).toThrow();
  if (instruction.kind !== 'intent') throw new Error('not an intent');
  expect(intentToStart(os, instruction)).toEqual({
    action: 'com.example.print.action.PRINT',
    package: 'com.example.print',
    extras: { copies: 2 },
  });
  expect(intentToStart(os, { ...instruction, package: 'com.example.other' })).toBeUndefined();
  expect(intentToStart(os, { ...instruction, intent: 'com.example.print.SHARE' })).toBeUndefined();
  expect(intentToStart(os, { ...instruction, extras: { copies: { n: 2 } } })).toBeUndefined();
});

test('intent handlers become intent filters with their names as declared', () => {
  const native = nativeOsConfig(os, { appId: 'dev.example.notes', scheme: 'dev.example.notes' });
  // Expo's own intent filters would prefix the names, so the framework's config plugin writes them.
  expect(native.android.intentFilters).toEqual([]);
  expect(native.plugins).toContainEqual([
    '@tortoise/mobile/intent-filters',
    {
      // In handler id order, as the catalog sorts them.
      filters: [
        { action: 'dev.example.notes.action.CREATE', categories: [] },
        {
          action: 'dev.example.notes.action.ATTACH',
          categories: ['dev.example.notes.category.PRINT'],
          data: { scheme: 'content', mimeType: 'application/pdf' },
        },
      ],
    },
  ]);
});
