import { afterEach, describe, expect, test } from 'bun:test';
import type { NetworkPort } from '@tortoise/kernel/plugin';
import { connectorConformance, conformanceEffect } from '@tortoise/testing/connectors';
import { httpTargetPort, readPointer, type HttpTargetOptions } from '../src';
import { FakeRestSystem } from '../src/testing';

const signal = () => new AbortController().signal;

/** A network port that binds every destination to one origin, as a site policy would. */
const networkTo = (origin: string): NetworkPort => ({
  client: (destination) => ({
    destination,
    fetch: (input, init) => fetch(new URL(String(input), origin), init),
  }),
  routedFetch: () => fetch,
});

const options = (
  network: NetworkPort,
  extra: Partial<HttpTargetOptions<unknown>> = {},
): HttpTargetOptions<unknown> => ({
  target: 'erp',
  network,
  destination: 'erp-api',
  request: (effect) => ({
    path: '/orders',
    body: { ...(effect.payload as object), ref: effect.id },
  }),
  idempotencyHeader: 'Idempotency-Key',
  rejections: [{ status: [422], code: '/error/code', message: '/error/detail' }],
  externalRef: '/id',
  lookup: { path: (id) => `/orders/by-key/${encodeURIComponent(id)}` },
  feed: {
    path: (cursor) => `/changes?after=${cursor ?? 0}`,
    items: '/data',
    cursor: '/next',
    more: '/hasMore',
    map: (item) => item,
  },
  ...extra,
});

const systems: FakeRestSystem[] = [];
afterEach(async () => {
  for (const system of systems.splice(0)) await system.stop();
});

async function harness(extra: Partial<HttpTargetOptions<unknown>> = {}) {
  const system = new FakeRestSystem();
  const real = httpTargetPort(options(networkTo(system.start()), extra));
  let next = 0;
  let interrupt = false;
  const effect = (payload: Parameters<typeof conformanceEffect>[0]['payload']) =>
    conformanceEffect({ id: `eff-${++next}`, target: 'erp', type: 'order.post', payload });
  return {
    port: {
      ...real,
      async deliver(item: Parameters<typeof real.deliver>[0], abort: AbortSignal) {
        const result = await real.deliver(item, abort);
        if (interrupt) {
          interrupt = false;
          throw new Error('The reply was lost');
        }
        return result;
      },
    },
    accepted: () => effect({ sku: 'SKU-1', qty: 1 }),
    rejected: () => effect({ qty: 1 }),
    applied: async (item: { id: string }) => system.applied.get(item.id) ?? 0,
    failNext: () => {
      system.failNext = 503;
    },
    interruptNext: () => {
      interrupt = true;
    },
    change: async () => system.change(),
    close: () => system.stop(),
  };
}

describe('with an idempotency header', () => {
  for (const check of connectorConformance(() => harness()))
    test(check.name, async () => expect(await check.run()).toEqual({ passed: true }));
});

describe('with lookup only', () => {
  for (const check of connectorConformance(() => harness({ idempotencyHeader: undefined })))
    test(check.name, async () => {
      const result = await check.run();
      // Without the header the fake cannot deduplicate; the lookup before resend must.
      expect(result).toEqual({ passed: true });
    });
});

describe('HTTP target', () => {
  test('a rejection rule maps status and body to a code and message', async () => {
    const system = new FakeRestSystem();
    systems.push(system);
    const port = httpTargetPort(options(networkTo(system.start())));
    const effect = conformanceEffect({ id: 'e1', target: 'erp', type: 'x', payload: { qty: 1 } });
    expect(await port.deliver(effect, signal())).toEqual({
      status: 'rejected',
      code: 'NO_SKU',
      message: 'Every line needs a SKU',
    });
  });

  test('an unlisted error status is transient, and an unreachable system is too', async () => {
    const system = new FakeRestSystem();
    systems.push(system);
    const origin = system.start();
    const port = httpTargetPort(options(networkTo(origin)));
    const effect = conformanceEffect({ id: 'e1', target: 'erp', type: 'x', payload: { sku: 'A' } });
    system.failNext = 401;
    await expect(port.deliver(effect, signal())).rejects.toThrow('The system returned 401');
    await system.stop();
    await expect(port.deliver(effect, signal())).rejects.toThrow('erp could not be reached');
  });

  test('a target with neither an idempotency header nor a lookup is refused', () => {
    expect(() =>
      httpTargetPort(
        options(networkTo('http://127.0.0.1:1'), {
          idempotencyHeader: undefined,
          lookup: undefined,
        }),
      ),
    ).toThrow('idempotency header or a lookup');
  });

  test('every request goes to the declared destination through the network port', async () => {
    const seen: string[] = [];
    const network: NetworkPort = {
      client: (destination) => ({
        destination,
        fetch: async (input) => {
          seen.push(`${destination} ${String(input)}`);
          return Response.json({ id: 'R1' }, { status: 201 });
        },
      }),
      routedFetch: () => fetch,
    };
    const port = httpTargetPort(options(network));
    const effect = conformanceEffect({ id: 'e1', target: 'erp', type: 'x', payload: { sku: 'A' } });
    expect(await port.deliver(effect, signal())).toEqual({ status: 'accepted', externalRef: 'R1' });
    expect(seen).toEqual(['erp-api /orders']);
  });

  test('a 202 is pending, and a lookup body can say it is still pending', async () => {
    const network: NetworkPort = {
      client: (destination) => ({
        destination,
        fetch: async (input) =>
          String(input).startsWith('/orders/by-key')
            ? Response.json({ id: 'R1', state: 'approval' })
            : Response.json({ id: 'R1' }, { status: 202 }),
      }),
      routedFetch: () => fetch,
    };
    const port = httpTargetPort(
      options(network, {
        pendingStatus: [202],
        lookup: {
          path: (id) => `/orders/by-key/${id}`,
          pendingWhen: (body) => readPointer(body, '/state') === 'approval',
        },
      }),
    );
    const effect = conformanceEffect({ id: 'e1', target: 'erp', type: 'x', payload: { sku: 'A' } });
    expect(await port.deliver(effect, signal())).toEqual({ status: 'pending', externalRef: 'R1' });
    expect(await port.lookup!('e1', signal())).toEqual({ status: 'pending', externalRef: 'R1' });
  });

  test('JSON pointers follow RFC 6901 escapes and stop at a missing step', () => {
    const value = { 'a/b': { '~k': [10, 20] } };
    expect(readPointer(value, '/a~1b/~0k/1')).toBe(20);
    expect(readPointer(value, '/a~1b/missing/0')).toBeUndefined();
    expect(readPointer(value, '')).toBe(value);
  });
});
