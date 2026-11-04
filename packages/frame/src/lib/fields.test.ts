import { expect, test } from 'bun:test';
import { z } from 'zod';
import { blobRefSchema, defineCapability, jsonSchema } from '@tortoise/contracts';
import {
  formatBytes,
  fromDateInput,
  formatDate,
  humanize,
  inferKind,
  plainValue,
  recordFields,
  shownFields,
  statusTone,
} from './fields';

test('a list or record field reads as text, not as [object Object]', () => {
  expect(plainValue(['PTX-40', 'PTX-63'])).toBe('PTX-40, PTX-63');
  expect(plainValue([{ partNumber: 'BSH-145-1250', quantity: 2 }])).toBe('1 item');
  expect(plainValue([{ a: 1 }, { a: 2 }])).toBe('2 items');
  expect(plainValue({ kv: 145 })).toBe('{"kv":145}');
  expect(plainValue(1250)).toBe('1250');
});

test('field names read as labels', () => {
  expect(humanize('createdAt')).toBe('Created at');
  expect(humanize('lot_number')).toBe('Lot number');
  expect(humanize('open')).toBe('Open');
});

test('a kind is inferred from the name and schema when none is declared', () => {
  expect(inferKind('createdAt', { type: 'number' })).toBe('date-time');
  expect(inferKind('dueDate', { type: 'string' })).toBe('date');
  expect(inferKind('status', { type: 'string', enum: ['open', 'done'] })).toBe('status');
  expect(inferKind('kind', { type: 'string', enum: ['a', 'b'] })).toBe('choice');
  expect(inferKind('note', { type: ['string', 'null'] })).toBe('text');
  expect(inferKind('count', { type: 'integer' })).toBe('number');
  expect(inferKind('photo', jsonSchema(blobRefSchema).jsonSchema as never)).toBe('file');
  expect(inferKind('lines', { type: 'array' })).toBe('json');
});

test('shown fields come from the display declaration, else the scalar schema fields', () => {
  const item = z.strictObject({
    id: z.string(),
    title: z.string(),
    status: z.enum(['open', 'done']),
    createdAt: z.number(),
    lines: z.array(z.string()),
  });
  const base = {
    kind: 'query' as const,
    input: jsonSchema(z.strictObject({})),
    permission: { action: 'read', resourceType: 'Thing' },
    ui: { exception: 'test' },
  };
  const get = defineCapability({ ...base, id: 'thing.get', output: jsonSchema(item) });
  expect(recordFields(get.output.jsonSchema, false)).toEqual([
    'id',
    'title',
    'status',
    'createdAt',
  ]);
  expect(shownFields(get, false).map((field) => [field.name, field.kind])).toEqual([
    ['id', 'text'],
    ['title', 'text'],
    ['status', 'status'],
    ['createdAt', 'date-time'],
  ]);
  const list = defineCapability({
    ...base,
    id: 'thing.list',
    output: jsonSchema(z.strictObject({ items: z.array(item), total: z.number() })),
    display: {
      fields: [
        { name: 'title', label: 'Name' },
        { name: 'status', kind: 'status', tones: { done: 'positive' } },
        { name: 'createdAt', kind: 'date' },
      ],
    },
  });
  expect(shownFields(list, true)).toMatchObject([
    { name: 'title', label: 'Name', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'status', tones: { done: 'positive' } },
    { name: 'createdAt', label: 'Created at', kind: 'date', type: 'number' },
  ]);
  expect(shownFields(get, false, 2).map((field) => field.name)).toEqual(['id', 'title']);
});

test('dates format in the locale and other values pass through', () => {
  const at = Date.UTC(2026, 10, 3, 14, 30);
  expect(formatDate(at, 'date')).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at)),
  );
  expect(formatDate(new Date(at).toISOString())).toContain('2026');
  expect(formatDate('not a date')).toBe('not a date');
  expect(formatDate(undefined)).toBe('');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
});

test('a date input reads as local midnight, so the day does not shift west of UTC', () => {
  const day = fromDateInput('2026-11-04')!;
  expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([
    2026, 10, 4, 0,
  ]);
  expect(fromDateInput('2026-11-04T09:15')!.getHours()).toBe(9);
  expect(fromDateInput('soon')).toBeUndefined();
});

test('a status tone is the declared one, else read from the word', () => {
  expect(statusTone('done', { done: 'positive' })).toBe('positive');
  expect(statusTone('open', { done: 'positive' })).toBe('neutral');
  expect(statusTone('rejected')).toBe('negative');
  expect(statusTone('accepted')).toBe('positive');
  expect(statusTone('pending')).toBe('warning');
  expect(statusTone('open')).toBe('neutral');
});
