import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineDataProvider,
  defineModule,
  jsonSchema,
  type InputOf,
  type NetworkDestination,
  type OutputOf,
} from '../src/index';

const accounts = defineDataProvider({
  id: 'crm.account',
  target: 'crm',
  identity: 'caller-or-service',
  resourceType: 'Account',
  query: z.strictObject({ q: z.string() }),
  item: z.strictObject({ externalId: z.string(), name: z.string() }),
  descriptions: { search: 'Search accounts.', lookup: 'Read one account.' },
  ui: { lookup: { exception: 'agents resolve a known ID' } },
});
const reads: NetworkDestination = {
  id: 'crm-api',
  purpose: 'Search the CRM',
  direction: 'egress',
  scope: 'internet',
  protocol: 'https',
  reads: ['crm'],
  dataClasses: ['account-query'],
  availability: 'optional',
  offline: 'degrade',
};

describe('data provider', () => {
  test('declares a search and a lookup query with literal IDs and typed envelopes', () => {
    const searchId: 'crm.account.search' = accounts.search.id;
    const lookupId: 'crm.account.lookup' = accounts.lookup.id;
    const input: InputOf<typeof accounts.search> = { q: 'acme' };
    const output: OutputOf<typeof accounts.lookup> = {
      items: [{ externalId: '1', name: 'Acme' }],
      source: { target: 'crm', status: 'ok', fetchedAt: 1 },
    };
    expect([searchId, lookupId, input.q, output.items.length]).toEqual([
      'crm.account.search',
      'crm.account.lookup',
      'acme',
      1,
    ]);
    expect(accounts.search.remote).toEqual({ target: 'crm', identity: 'caller-or-service' });
    expect(accounts.search.ui).toEqual({ binding: 'crm.account.search' });
    expect(accounts.lookup.ui).toEqual({ exception: 'agents resolve a known ID' });
    expect(accounts.lookup.input.parse({ externalId: 'X1' })).toEqual({ externalId: 'X1' });
    expect(() =>
      accounts.search.output.parse({ items: [], source: { target: 'crm', status: 'maybe' } }),
    ).toThrow();
  });

  test('search pages with an opaque cursor; the provider cannot claim the cursor field', () => {
    const page: InputOf<typeof accounts.search> = { q: 'acme', cursor: 'opaque' };
    expect(accounts.search.input.parse(page)).toEqual(page);
    expect(() => accounts.search.input.parse({ q: 'a', cursor: '' })).toThrow();
    expect(() => accounts.search.input.parse({ q: 'a', other: 1 })).toThrow();
    expect(() => accounts.lookup.input.parse({ externalId: 'X1', cursor: 'c' })).toThrow();
    const next: OutputOf<typeof accounts.search>['next'] = 'c2';
    expect(
      accounts.search.output.parse({
        items: [],
        next,
        source: { target: 'crm', status: 'ok', fetchedAt: 1 },
      }).next,
    ).toBe('c2');
    expect(() =>
      defineDataProvider({
        id: 'crm.lead',
        target: 'crm',
        identity: 'caller',
        resourceType: 'Lead',
        query: z.strictObject({ q: z.string(), cursor: z.number() }),
        item: z.strictObject({ externalId: z.string() }),
        descriptions: { search: 'Search.', lookup: 'Read.' },
      }),
    ).toThrow('Provider query must not declare cursor; paging adds it: crm.lead');
  });

  test('the catalog carries the remote declaration and its read destination', () => {
    const catalog = buildCatalog([
      defineModule({
        id: 'crm',
        capabilities: accounts.capabilities,
        requirements: { network: [reads] },
      }),
    ]);
    const search = catalog.operations.find((operation) => operation.id === 'crm.account.search')!;
    expect(search.remote).toEqual({ target: 'crm', identity: 'caller-or-service' });
    expect(search.destinations).toEqual(['crm-api']);
  });

  test('remote reads fail closed without a destination, on commands, or over ingress', () => {
    expect(() =>
      buildCatalog([defineModule({ id: 'crm', capabilities: accounts.capabilities })]),
    ).toThrow('Remote target crm has no declared network destination: crm.account.search');
    const command = defineCapability({
      id: 'crm.account.push',
      kind: 'command',
      input: jsonSchema(z.strictObject({})),
      output: jsonSchema(z.strictObject({})),
      permission: { action: 'push', resourceType: 'Account' },
      ui: { exception: 'fixture' },
      remote: { target: 'crm', identity: 'caller' },
    });
    expect(() =>
      buildCatalog([
        defineModule({ id: 'crm', capabilities: [command], requirements: { network: [reads] } }),
      ]),
    ).toThrow('Remote read requires a query with a target and identity: crm.account.push');
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'crm',
          capabilities: accounts.capabilities,
          requirements: { network: [{ ...reads, direction: 'ingress' }] },
        }),
      ]),
    ).toThrow('Remote reads require an egress destination');
  });
});
