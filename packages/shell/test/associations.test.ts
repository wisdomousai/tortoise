import { expect, test } from 'bun:test';
import { z } from 'zod';
import { buildCatalog, defineModule, jsonSchema, type OsHandler } from '@agent-native/contracts';
import { associationFiles } from '../src/index';

const id = jsonSchema(z.strictObject({ id: z.string() }));
const link = (handler: Partial<OsHandler> & { id: string; path: string }): OsHandler =>
  ({
    kind: 'link',
    description: 'Open.',
    params: id,
    target: { screen: '/notes', search: { id: '{id}' } },
    ...handler,
  }) as OsHandler;
const os = buildCatalog([
  defineModule({
    id: 'notes',
    capabilities: [],
    os: {
      handlers: [
        link({ id: 'note.open', path: '/notes/:id', verified: true }),
        link({ id: 'note.local', path: '/local/:id' }),
      ],
    },
  }),
]).os;
const cert = Array.from({ length: 32 }, () => 'AB').join(':');
const identity = { appId: 'dev.example.notes', teamId: 'ABCDE12345', sha256Certs: [cert] };

test('only verified links are associated, with parameters as wildcards', () => {
  expect(associationFiles(os, identity)).toEqual({
    'apple-app-site-association': {
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.dev.example.notes'],
            components: [{ '/': '/notes/*', comment: 'note.open' }],
          },
        ],
      },
    },
    'assetlinks.json': [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'dev.example.notes',
          sha256_cert_fingerprints: [cert],
        },
      },
    ],
  });
});

test('malformed store identities and an application without verified links are refused', () => {
  expect(() => associationFiles(os, { ...identity, teamId: 'abc' })).toThrow('team id');
  expect(() => associationFiles(os, { ...identity, sha256Certs: [] })).toThrow('fingerprints');
  expect(() => associationFiles(os, { ...identity, sha256Certs: ['ab:cd'] })).toThrow(
    'fingerprints',
  );
  expect(() => associationFiles({ handlers: [], actions: [] }, identity)).toThrow(
    'No verified link',
  );
});
