import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineDataProvider, defineModule } from '@agent-native/contracts';
import { createApplication, createMemoryStorage, type SourceCall } from '@agent-native/runtime';
import {
  createRemoteSource,
  DeliveryFailure,
  implementDataProvider,
  type CallerCredentials,
  type SearchAccess,
  type SystemOfRecordPort,
} from '../src/index';

const contacts = defineDataProvider({
  id: 'crm.contact',
  target: 'crm',
  identity: 'caller-or-service',
  resourceType: 'Contact',
  query: z.strictObject({ q: z.string() }),
  item: z.strictObject({ externalId: z.string(), name: z.string() }),
  descriptions: { search: 'Search contacts.', lookup: 'Read one contact.' },
});
const tokens: Record<string, string> = { alice: 'alice-token' };
const credentials = (service?: string): CallerCredentials<string> => ({
  forPrincipal: async (principalId) => tokens[principalId],
  ...(service ? { service: async () => service } : {}),
});
const seen: SearchAccess<string>[] = [];
const port: SystemOfRecordPort<unknown, string> = {
  describe: () => ({ target: 'crm', idempotentDelivery: true }),
  deliver: async () => ({ status: 'accepted' }),
  async search(request, access) {
    seen.push(access);
    if (request.operation === 'crm.contact.lookup') return { items: [{ id: 'C2', name: 'Bo' }] };
    if ((request.query as { cursor?: string }).cursor === 'page-2')
      return { items: [{ id: 'C3', name: 'Cy' }] };
    return { items: [{ id: 'C1', name: `Ann (${access.identity})` }], next: 'page-2' };
  },
};
const call = (principalId: string, identity: SourceCall['identity']): SourceCall => ({
  context: { workspaceId: 'w', principalId },
  identity,
  signal: new AbortController().signal,
});
const request = { operation: 'crm.contact.search', query: { q: 'a' } };

describe('remote source', () => {
  test('acts with the caller credential first, then a permitted service account', async () => {
    seen.length = 0;
    const source = createRemoteSource({ target: 'crm', port, credentials: credentials('svc') });
    // The target's page cursor passes through untouched.
    expect(await source.search(request, call('alice', 'caller'))).toMatchObject({
      identity: 'caller',
      next: 'page-2',
    });
    expect(await source.search(request, call('bob', 'caller-or-service'))).toMatchObject({
      identity: 'service',
    });
    expect(seen.map((access) => access.credential)).toEqual(['alice-token', 'svc']);
    await expect(source.search(request, call('bob', 'caller'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Connect your crm account to search it',
    });
    const noService = createRemoteSource({ target: 'crm', port, credentials: credentials() });
    await expect(noService.search(request, call('bob', 'caller-or-service'))).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  test('a service read never asks for the caller credential', async () => {
    seen.length = 0;
    const source = createRemoteSource({ target: 'crm', port, credentials: credentials('svc') });
    expect(await source.search(request, call('alice', 'service'))).toMatchObject({
      identity: 'service',
    });
    expect(seen.map((access) => access.credential)).toEqual(['svc']);
    const noService = createRemoteSource({ target: 'crm', port, credentials: credentials() });
    await expect(noService.search(request, call('alice', 'service'))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'crm has no service credential',
    });
  });

  test('a delivery failure is a safe unavailable message; a port without search is unavailable', async () => {
    const failing = createRemoteSource({
      target: 'crm',
      port: {
        ...port,
        search: async () => {
          throw new DeliveryFailure('CRM rate limit reached');
        },
      },
      credentials: credentials(),
    });
    await expect(failing.search(request, call('alice', 'caller'))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'CRM rate limit reached',
    });
    const { search: _search, ...writeOnly } = port;
    const unsupported = createRemoteSource({
      target: 'crm',
      port: writeOnly,
      credentials: credentials(),
    });
    await expect(unsupported.search(request, call('alice', 'caller'))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  test('implemented providers handle search and lookup through the runtime', async () => {
    const app = createApplication({
      modules: [
        defineModule({
          id: 'crm',
          capabilities: contacts.capabilities,
          requirements: {
            network: [
              {
                id: 'crm-api',
                purpose: 'CRM',
                direction: 'egress',
                scope: 'internet',
                protocol: 'https',
                reads: ['crm'],
                dataClasses: ['contact-query'],
                availability: 'optional',
                offline: 'degrade',
              },
            ],
          },
        }),
      ],
      storage: createMemoryStorage({}),
      services: {},
      sources: { crm: createRemoteSource({ target: 'crm', port, credentials: credentials() }) },
      authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      handlers: implementDataProvider<{}, {}, typeof contacts>(contacts, {
        item: (found) => {
          const parsed = z.object({ id: z.string(), name: z.string() }).safeParse(found);
          return parsed.success
            ? { externalId: parsed.data.id, name: parsed.data.name }
            : undefined;
        },
      }),
    });
    // An agent delegated by alice runs in alice's principal under a grant: alice's access applies.
    const agent = {
      workspaceId: 'w',
      principalId: 'alice',
      runId: 'run-1',
      grant: { operations: ['crm.contact.search', 'crm.contact.lookup'], runId: 'run-1' },
    };
    const searched = await app.query({ operation: 'crm.contact.search', input: { q: 'a' } }, agent);
    expect(searched.data.items).toEqual([{ externalId: 'C1', name: 'Ann (caller)' }]);
    expect(searched.data.next).toBe('page-2');
    // The cursor goes back to the source inside the request; the port decides what it means.
    const second = await app.query(
      { operation: 'crm.contact.search', input: { q: 'a', cursor: 'page-2' } },
      agent,
    );
    expect(second.data).toMatchObject({ items: [{ externalId: 'C3', name: 'Cy' }] });
    expect(second.data.next).toBeUndefined();
    const looked = await app.query(
      { operation: 'crm.contact.lookup', input: { externalId: 'C2' } },
      agent,
    );
    expect(looked.data.items).toEqual([{ externalId: 'C2', name: 'Bo' }]);
  });
});
