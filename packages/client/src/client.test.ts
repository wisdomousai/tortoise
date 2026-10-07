import { expect, test } from 'bun:test';
import {
  createHttpTransport,
  LiveQuery,
  type ChangeBatch,
  type Snapshot,
  type Transport,
} from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
class Changes implements AsyncIterableIterator<ChangeBatch> {
  private values: ChangeBatch[] = [];
  private waiting?: (value: IteratorResult<ChangeBatch>) => void;
  push(value: ChangeBatch) {
    if (this.waiting) {
      const done = this.waiting;
      this.waiting = undefined;
      done({ done: false, value });
    } else this.values.push(value);
  }
  next(): Promise<IteratorResult<ChangeBatch>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ done: false, value });
    return new Promise((done) => {
      this.waiting = done;
    });
  }
  async return(): Promise<IteratorResult<ChangeBatch>> {
    this.waiting?.({ done: true, value: undefined });
    this.waiting = undefined;
    return { done: true, value: undefined };
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
function fixture() {
  const calls: ReturnType<typeof deferred<Snapshot<string>>>[] = [];
  const changes = new Changes();
  const cursors: string[] = [];
  const transport: Transport = {
    query<T>() {
      const next = deferred<Snapshot<string>>();
      calls.push(next);
      return next.promise as Promise<Snapshot<T>>;
    },
    async command() {
      throw new Error('Unused');
    },
    events(cursor, signal) {
      cursors.push(cursor);
      signal.addEventListener(
        'abort',
        () => {
          void changes.return();
        },
        { once: true },
      );
      return changes;
    },
  };
  const live = new LiveQuery<string>(transport, 'fixture.read', {});
  const unsubscribe = live.subscribe(() => {});
  return { live, calls, changes, cursors, unsubscribe };
}
const snapshot = (data: string, authorizationRevision = 0): Snapshot<string> => ({
  data,
  authorizationRevision,
  cursor: `cursor-${data}`,
});
const batch = (authorizationRevision: number, reset = false): ChangeBatch => ({
  authorizationRevision,
  reset,
  cursor: `event-${authorizationRevision}`,
  changes: reset
    ? []
    : [{ resource: 'task:one', type: 'changed', operation: 'task.update', revision: 1 }],
});

test('snapshot cursor closes subscription race and clear fences an old in-flight response', async () => {
  const f = fixture();
  try {
    expect(f.calls).toHaveLength(1);
    f.calls[0]!.resolve(snapshot('initial'));
    await flush();
    expect(f.cursors).toEqual(['cursor-initial']);
    expect(f.live.getSnapshot().data).toBe('initial');
    f.changes.push(batch(0));
    await flush();
    expect(f.calls).toHaveLength(2);
    f.live.clear();
    expect(f.live.getSnapshot().data).toBeUndefined();
    f.calls[1]!.resolve(snapshot('stale'));
    await flush();
    expect(f.live.getSnapshot().data).toBeUndefined();
  } finally {
    f.unsubscribe();
  }
});

test('a revocation reset clears data while an earlier refresh is still pending', async () => {
  const f = fixture();
  try {
    f.calls[0]!.resolve(snapshot('protected'));
    await flush();
    f.changes.push(batch(0));
    await flush();
    expect(f.calls).toHaveLength(2);
    f.changes.push(batch(1, true));
    await flush();
    expect(f.live.getSnapshot().data).toBeUndefined();
    expect(f.live.getSnapshot().authorizationRevision).toBe(1);
    f.calls[1]!.resolve(snapshot('revoked-old', 0));
    await flush();
    expect(f.live.getSnapshot().data).not.toBe('revoked-old');
  } finally {
    f.unsubscribe();
    for (const call of f.calls) call.resolve(snapshot('cleanup', 2));
  }
});

test('unsubscribe prevents a late response from republishing cached data', async () => {
  const f = fixture();
  f.unsubscribe();
  f.calls[0]!.resolve(snapshot('late'));
  await flush();
  expect(f.live.getSnapshot().data).toBeUndefined();
});

test('an older failed refresh cannot erase a newer successful snapshot', async () => {
  const f = fixture();
  try {
    f.calls[0]!.resolve(snapshot('initial'));
    await flush();
    f.changes.push(batch(0));
    await flush();
    f.changes.push({ ...batch(0), cursor: 'second-change' });
    await flush();
    expect(f.calls).toHaveLength(3);
    f.calls[2]!.resolve(snapshot('newest'));
    await flush();
    expect(f.live.getSnapshot().data).toBe('newest');
    f.calls[1]!.reject(new Error('old request failed'));
    await flush();
    expect(f.live.getSnapshot().data).toBe('newest');
    expect(f.live.getSnapshot().error).toBeUndefined();
  } finally {
    f.unsubscribe();
  }
});

test('HTTP errors keep caller-safe details for field-level form errors', async () => {
  const transport = createHttpTransport({
    baseUrl: 'http://127.0.0.1:1',
    fetch: (async () =>
      Response.json(
        { error: { code: 'INVALID_INPUT', message: 'Enter a value', details: { field: 'value' } } },
        { status: 400 },
      )) as unknown as typeof fetch,
  });
  await expect(transport.command('x.record', {})).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    message: 'Enter a value',
    details: { field: 'value' },
  });
});
