import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readApplicationIdentity } from '../src/config';

const identityFile = (fields: Record<string, unknown>) => {
  const path = join(mkdtempSync(join(tmpdir(), 'identity-')), 'app.config.json');
  writeFileSync(path, JSON.stringify({ name: 'demo', displayName: 'Demo', ...fields }));
  return path;
};

describe('application identity', () => {
  test('the URL scheme defaults to the lower-case application ID', () => {
    expect(readApplicationIdentity(identityFile({ appId: 'dev.Example.my_app' })).scheme).toBe(
      'dev.example.my-app',
    );
  });

  test('a configured scheme is used when valid and unreserved', () => {
    expect(
      readApplicationIdentity(identityFile({ appId: 'dev.example.app', scheme: 'exampleapp' }))
        .scheme,
    ).toBe('exampleapp');
    for (const scheme of ['https', 'file', 'Bad', '1abc', 'a b', 42])
      expect(() =>
        readApplicationIdentity(identityFile({ appId: 'dev.example.app', scheme })),
      ).toThrow();
  });
});
