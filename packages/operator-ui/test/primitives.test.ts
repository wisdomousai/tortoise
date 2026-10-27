import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { applyKey, parseEntry, toleranceState } from '../src/lib/numeric-entry';
import { TapGuard } from '../src/hooks/use-tap-guard';
import { KeyBurstFilter } from '../src/hooks/use-operator-keys';

const type = (keys: string, rules?: Parameters<typeof applyKey>[2]) =>
  [...keys].reduce((value, key) => applyKey(value, key, rules), '');

describe('numeric entry', () => {
  test('builds decimal values and enforces the decimal limit', () => {
    expect(type('12.345', { decimals: 2 })).toBe('12.34');
    expect(type('.5')).toBe('0.5');
    expect(type('1.2.3')).toBe('1.23');
    expect(type('7', { decimals: 0 })).toBe('7');
    expect(type('7.', { decimals: 0 })).toBe('7');
  });

  test('uses the configured separator and parses either', () => {
    expect(type('3,25', { separator: ',' })).toBe('3,25');
    expect(type('3.25', { separator: ',' })).toBe('3,25');
    expect(parseEntry('3,25')).toBe(3.25);
    expect(parseEntry('3.25')).toBe(3.25);
  });

  test('drops leading zeros and toggles the sign only when allowed', () => {
    expect(type('005')).toBe('5');
    expect(type('0.05')).toBe('0.05');
    expect(type('4±')).toBe('4');
    expect(type('4±', { allowNegative: true })).toBe('-4');
    expect(type('4±±', { allowNegative: true })).toBe('4');
  });

  test('keeps a code as typed: leading zeros, digits only, up to its length', () => {
    expect(type('0042', { code: true })).toBe('0042');
    expect(type('1.2±-3', { code: true, allowNegative: true })).toBe('123');
    expect(type('123456789', { code: true, maxLength: 8 })).toBe('12345678');
    expect(applyKey('0042', 'Backspace', { code: true })).toBe('004');
  });

  test('edits and clears', () => {
    expect(applyKey('12.3', 'Backspace')).toBe('12.');
    expect(applyKey('12.3', 'Escape')).toBe('');
    expect(applyKey('12', 'x')).toBe('12');
    expect(type('1234567890123', { maxLength: 4 })).toBe('1234');
  });

  test('incomplete entries do not parse', () => {
    expect(parseEntry('')).toBeUndefined();
    expect(parseEntry('-')).toBeUndefined();
    expect(parseEntry('12.')).toBeUndefined();
  });

  test('reports tolerance and gauge position', () => {
    const tolerance = { lower: 10, upper: 20 };
    expect(toleranceState(undefined, tolerance)).toEqual({});
    expect(toleranceState(15, tolerance)).toEqual({ inside: true, position: 50 });
    expect(toleranceState(10, tolerance)).toEqual({ inside: true, position: 25 });
    expect(toleranceState(25, tolerance)).toEqual({ inside: false, position: 100 });
    expect(toleranceState(25, { upper: 20 })).toEqual({ inside: false });
  });
});

describe('tap guard', () => {
  const rect = { top: 100, left: 100 };
  test('accepts a still tap, then ignores a second tap inside the cooldown', () => {
    const guard = new TapGuard({ cooldownMs: 400 });
    guard.pointerDown({ x: 110, y: 110 }, rect);
    expect(guard.activate(1000, { point: { x: 112, y: 111 }, rect })).toBe('accept');
    guard.pointerDown({ x: 110, y: 110 }, rect);
    expect(guard.activate(1200, { point: { x: 110, y: 110 }, rect })).toBe('cooldown');
    expect(guard.activate(1500)).toBe('accept');
  });

  test('rejects scrolls, layout shifts and pending activations', () => {
    const guard = new TapGuard();
    guard.pointerDown({ x: 110, y: 110 }, rect);
    expect(guard.activate(0, { point: { x: 110, y: 160 }, rect })).toBe('moved');
    guard.pointerDown({ x: 110, y: 110 }, rect);
    expect(guard.activate(0, { point: { x: 110, y: 110 }, rect: { top: 160, left: 100 } })).toBe(
      'shifted',
    );
    expect(guard.activate(0, { pending: true })).toBe('pending');
  });
});

test('registry and theme stylesheet match the manifest, and every import is declared', () => {
  const result = Bun.spawnSync(
    [
      'bun',
      join(import.meta.dir, '..', '..', '..', 'scripts', 'build-operator-registry.ts'),
      '--check',
    ],
    { stderr: 'pipe', stdout: 'pipe' },
  );
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
});

describe('key burst filter', () => {
  test('a single key press fires after the window', () => {
    const filter = new KeyBurstFilter(50);
    expect(filter.push('3', 1000)).toBe('defer');
    expect(filter.complete(1050)).toBe('3');
    expect(filter.push('PageDown', 2000)).toBe('fire');
  });

  test('a scanner burst fires nothing, including its Enter', () => {
    const filter = new KeyBurstFilter(50);
    const verdicts = [...'ORD-12345', 'Enter'].map((key, index) =>
      filter.push(key, 1000 + index * 4),
    );
    expect(verdicts[0]).toBe('defer');
    expect(verdicts.slice(1).every((verdict) => verdict === 'drop')).toBe(true);
    expect(filter.complete(1100)).toBeUndefined();
    // A deliberate key after the burst works again.
    expect(filter.push('1', 1500)).toBe('defer');
    expect(filter.complete(1550)).toBe('1');
  });
});

describe('tap guard sources', () => {
  test('a pointer click without a seen press is an orphan', () => {
    const guard = new TapGuard();
    expect(guard.activate(0, { point: { x: 1, y: 1 }, rect: { top: 0, left: 0 } })).toBe('orphan');
  });

  test('keyboard cooldown only suppresses the same key', () => {
    const guard = new TapGuard({ cooldownMs: 400 });
    expect(guard.activate(1000, { key: 'S03' })).toBe('accept');
    expect(guard.activate(1100, { key: 'S03' })).toBe('cooldown');
    expect(guard.activate(1150, { key: 'S11' })).toBe('accept');
  });
});
