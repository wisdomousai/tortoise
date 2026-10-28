import { expect, test } from 'bun:test';

// The screen's session module reads the page's location when it loads.
(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/');
const { plainValue } = await import('./collection-screen');

test('a list or record field reads as text, not as [object Object]', () => {
  expect(plainValue(['PTX-40', 'PTX-63'])).toBe('PTX-40, PTX-63');
  expect(plainValue([{ partNumber: 'BSH-145-1250', quantity: 2 }])).toBe('1 item');
  expect(plainValue([{ a: 1 }, { a: 2 }])).toBe('2 items');
  expect(plainValue({ kv: 145 })).toBe('{"kv":145}');
  expect(plainValue(1250)).toBe('1250');
});
