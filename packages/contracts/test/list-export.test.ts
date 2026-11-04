import { expect, test } from 'bun:test';
import { csvColumns, csvText, readAllPages } from '../src/list-export';

test('CSV quotes cells with commas, quotes or line breaks and opens a formula start as text', () => {
  const columns = [
    { name: 'id', label: 'Lot' },
    { name: 'note', label: 'Note, free text' },
    { name: 'tags', label: 'Tags' },
  ];
  expect(
    csvText(columns, [
      { id: 'L1', note: 'line one\nline two', tags: ['a', 'b'] },
      { id: '=cmd', note: 'said "ok"', tags: null },
      { id: -4, note: { at: 1 } },
    ]),
  ).toBe(
    'Lot,"Note, free text",Tags\r\n' +
      'L1,"line one\nline two","a, b"\r\n' +
      `'=cmd,"said ""ok""",\r\n` +
      '-4,"{""at"":1}",\r\n',
  );
});

test('the columns are the declared display fields, else every field in first-seen order', () => {
  expect(csvColumns({ fields: [{ name: 'id', label: 'Lot' }, { name: 'bin' }] }, [])).toEqual([
    { name: 'id', label: 'Lot' },
    { name: 'bin', label: 'bin' },
  ]);
  expect(csvColumns(undefined, [{ id: 1 }, { bin: 'A', id: 2 }])).toEqual([
    { name: 'id', label: 'id' },
    { name: 'bin', label: 'bin' },
  ]);
});

test('reading all pages stops at the total, or at an empty page when the list shrinks', async () => {
  const rows = Array.from({ length: 250 }, (_, index) => index);
  const offsets: number[] = [];
  const all = await readAllPages(async (offset, limit) => {
    offsets.push(offset);
    return { items: rows.slice(offset, offset + limit), total: rows.length };
  });
  expect(all).toEqual(rows);
  expect(offsets).toEqual([0, 100, 200]);
  const shrunk = await readAllPages(async (offset) => ({
    items: offset ? [] : [1, 2],
    total: 5,
  }));
  expect(shrunk).toEqual([1, 2]);
});
