import { expect, test } from 'bun:test';
import { assertGlobals, installGlobals, missingGlobals } from '../src/globals';

// Under `bun run test:portable` these globals are the kernel's replacements; otherwise Bun's.
test('the required globals behave as the runtime expects', async () => {
  installGlobals();
  expect(missingGlobals()).toEqual([]);
  expect(() => assertGlobals()).not.toThrow();

  expect(crypto.randomUUID()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(crypto.randomUUID()).not.toBe(crypto.randomUUID());

  const value = { list: [1, { nested: true }], when: new Date(0), missing: undefined };
  const copy = structuredClone(value);
  expect(copy).toEqual(value);
  expect(copy.list).not.toBe(value.list);
  expect(() => structuredClone({ run: () => 1 })).toThrow();

  const first = new AbortController();
  const second = new AbortController();
  const either = AbortSignal.any([first.signal, second.signal]);
  expect(either.aborted).toBe(false);
  second.abort(new Error('stopped'));
  expect(either.aborted).toBe(true);
  expect((either.reason as Error).message).toBe('stopped');
  expect(AbortSignal.any([AbortSignal.abort('early')]).reason).toBe('early');

  const timeout = AbortSignal.timeout(5);
  await new Promise((resolve) => timeout.addEventListener('abort', resolve, { once: true }));
  expect((timeout.reason as Error).name).toBe('TimeoutError');
});
