import { expect, test } from 'bun:test';
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';
import type { ChangeBatch, Snapshot, Transport } from '@agent-native/client';
import { ScanDetector } from './capture';
import { changedResourceTypes, createLiveBindings, isAffected } from './query';

const query = (id: string, dependencies?: string[]) =>
  defineCapability({
    id,
    kind: 'query',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ n: z.number() })),
    permission: { action: 'read', resourceType: 'x' },
    ui: { exception: 'test fixture' },
    ...(dependencies ? { dependencies } : {}),
  });
const lots = query('lot.list', ['lot', 'result']);
const plants = query('plant.list', ['plant']);
const undeclared = query('misc.get');
const search = {
  ...query('crm.account.search'),
  remote: { target: 'crm', identity: 'caller' },
} as const;

function fixture() {
  const calls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let revision = 0;
  const pending: ((value: Snapshot<unknown>) => void)[] = [];
  let hold = false;
  // A change stream the test feeds one batch at a time.
  const stream: ChangeBatch[] = [];
  let wake: (() => void) | undefined;
  const transport: Transport = {
    query: async <T>(operation: string, _input: unknown, signal?: AbortSignal) => {
      calls.push(operation);
      signals.push(signal);
      const snapshot = { data: { n: calls.length }, cursor: 'c', authorizationRevision: revision };
      if (hold) return new Promise<Snapshot<T>>((resolve) => pending.push(resolve as never));
      return snapshot as Snapshot<T>;
    },
    command: async () => {
      throw new Error('unused');
    },
    events: async function* (_cursor, signal) {
      while (!signal.aborted) {
        const next = stream.shift();
        if (next) yield next;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
  const client = new QueryClient();
  const live = createLiveBindings(transport);
  const observe = (capability: typeof lots) => {
    const observer = new QueryObserver(client, live.liveQueryOptions(capability, {}));
    const unsubscribe = observer.subscribe(() => {});
    return { observer, unsubscribe };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return {
    calls,
    signals,
    client,
    live,
    observe,
    settle,
    setRevision: (value: number) => (revision = value),
    hold: (value: boolean) => (hold = value),
    release: (snapshot: Snapshot<unknown>) => pending.shift()!(snapshot),
    emit: (next: ChangeBatch) => (stream.push(next), wake?.()),
  };
}
const batch = (partial: Partial<ChangeBatch>): ChangeBatch => ({
  cursor: 'next',
  authorizationRevision: 0,
  reset: false,
  changes: [],
  ...partial,
});
const change = (resource: string) => ({ resource, type: 'x', operation: 'op', revision: 1 });

test('dependency matching is conservative for undeclared queries', () => {
  const types = changedResourceTypes({ changes: [change('lot:1'), change('lot:2')] });
  expect([...types]).toEqual(['lot']);
  expect(isAffected(['lot', 'result'], types)).toBe(true);
  expect(isAffected(['plant'], types)).toBe(false);
  expect(isAffected(undefined, types)).toBe(true);
  expect(isAffected([], types)).toBe(true);
});

test('a change batch refetches only active queries whose dependencies changed, once', async () => {
  const { calls, client, live, observe, settle } = fixture();
  observe(lots);
  observe(plants);
  observe(undeclared);
  await settle();
  expect(calls.sort()).toEqual(['lot.list', 'misc.get', 'plant.list']);
  calls.length = 0;
  await live.applyBatch(client, batch({ reset: true }));
  await settle();
  expect(calls.length).toBe(3);
  calls.length = 0;
  // Three lot/result changes coalesce into one refetch per affected query.
  await live.applyBatch(
    client,
    batch({ changes: [change('lot:1'), change('result:9'), change('lot:2')] }),
  );
  await settle();
  expect(calls.sort()).toEqual(['lot.list', 'misc.get']);
});

test('a remote query ignores local changes, keeps its signal and resets on a permission change', async () => {
  const { calls, signals, client, live, settle, setRevision } = fixture();
  const observer = new QueryObserver(client, live.remoteQueryOptions(search, {}));
  observer.subscribe(() => {});
  await settle();
  expect(calls).toEqual(['crm.account.search']);
  expect(signals[0]).toBeInstanceOf(AbortSignal);
  // Neither a stream reset nor any change calls the target again.
  await live.applyBatch(client, batch({ reset: true }));
  await live.applyBatch(client, batch({ changes: [change('account:1')] }));
  await settle();
  expect(calls).toEqual(['crm.account.search']);
  setRevision(1);
  const reset = live.applyBatch(client, batch({ reset: true, authorizationRevision: 1 }));
  expect(observer.getCurrentResult().data).toBeUndefined();
  await reset;
  await settle();
  expect(calls).toEqual(['crm.account.search', 'crm.account.search']);
});

test('a paged remote query follows next cursors, stops at the last page and ignores changes', async () => {
  const inputs: unknown[] = [];
  const transport: Transport = {
    query: async <T>(_operation: string, input: unknown) => {
      inputs.push(input);
      const data = (input as { cursor?: string }).cursor
        ? { items: [2] }
        : { items: [1], next: 'p2' };
      return { data, cursor: 'c', authorizationRevision: 0 } as Snapshot<T>;
    },
    command: async () => {
      throw new Error('unused');
    },
    events: async function* () {},
  };
  const client = new QueryClient();
  const live = createLiveBindings(transport);
  const observer = new InfiniteQueryObserver(client, live.remoteInfiniteQueryOptions(search, {}));
  observer.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(observer.getCurrentResult().hasNextPage).toBe(true);
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data as unknown).toEqual([
    { items: [1], next: 'p2' },
    { items: [2] },
  ]);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  // The first page sends no cursor; the second sends the first page's `next`.
  expect(inputs).toEqual([{}, { cursor: 'p2' }]);
  await live.applyBatch(client, batch({ reset: true }));
  await live.applyBatch(client, batch({ changes: [change('account:1')] }));
  expect(inputs).toHaveLength(2);
});

test('a permission change clears cached data before refetching', async () => {
  const { client, live, observe, settle, setRevision } = fixture();
  const { observer } = observe(lots);
  await live.applyBatch(client, batch({ reset: true }));
  await settle();
  expect(observer.getCurrentResult().data).toBeDefined();
  setRevision(1);
  const reset = live.applyBatch(client, batch({ reset: true, authorizationRevision: 1 }));
  // resetQueries drops the data synchronously; the refetch then fills it under revision 1.
  expect(observer.getCurrentResult().data).toBeUndefined();
  await reset;
  await settle();
  expect(observer.getCurrentResult().data).toBeDefined();
});

test('a snapshot from before a revocation is never cached', async () => {
  const { client, live, observe, settle, hold, release } = fixture();
  await live.applyBatch(client, batch({ reset: true, authorizationRevision: 1 }));
  hold(true);
  const { observer } = observe(lots);
  await settle();
  release({ data: { n: 99 }, cursor: 'old', authorizationRevision: 0 });
  await settle();
  expect(observer.getCurrentResult().data).toBeUndefined();
});

test('a refetch that never answers does not hold back a later revocation', async () => {
  const { client, live, observe, settle, hold, setRevision, emit } = fixture();
  const { observer } = observe(lots);
  await settle();
  const controller = new AbortController();
  void live.follow(client, controller.signal);
  // The stream's first batch refetches under the same revision; that refetch hangs.
  hold(true);
  emit(batch({ reset: true }));
  await settle();
  expect(observer.getCurrentResult().data).toBeDefined();
  setRevision(1);
  emit(batch({ reset: true, authorizationRevision: 1 }));
  await settle();
  expect(observer.getCurrentResult().data).toBeUndefined();
  controller.abort();
});

test('a first stream batch under a newer revision clears data cached before it', async () => {
  const { client, live, observe, settle, hold, setRevision } = fixture();
  const { observer } = observe(lots);
  await settle();
  expect(observer.getCurrentResult().data).toBeDefined();
  // Revoked between the initial query and the subscription's first batch.
  setRevision(1);
  hold(true);
  void live.applyBatch(client, batch({ reset: true, authorizationRevision: 1 }));
  expect(observer.getCurrentResult().data).toBeUndefined();
});

test('scanner bursts are told apart from typing', () => {
  const detector = new ScanDetector({ maxGapMs: 30 });
  let t = 0;
  for (const key of '4000001') detector.push(key, (t += 8));
  expect(detector.push('Enter', (t += 8))).toEqual({ kind: 'scan', code: '4000001' });
  for (const key of '220.02') detector.push(key, (t += 180));
  expect(detector.push('Enter', (t += 150))).toEqual({ kind: 'typing' });
  expect(detector.push('Enter', (t += 5))).toBeUndefined();
  detector.push('Shift', (t += 1));
  for (const key of 'AB') detector.push(key, (t += 5));
  expect(detector.push('Enter', (t += 5))).toEqual({ kind: 'typing' });
});
