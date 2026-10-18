import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resourcePath } from '@agent-native/host/runtime-manifest';
import { validateLoopbackEndpoint } from '../src/service-lifecycle';
import { readNpmTarball, targetPackages, verifyIntegrity } from '../../../scripts/package-assets';
function tar(path: string, type = '0') {
  const header = Buffer.alloc(512);
  header.write(path);
  header.write('0000755\0', 100);
  header.write('00000000001\0', 124);
  header.write(type, 156);
  return gzipSync(Buffer.concat([header, Buffer.from('x'), Buffer.alloc(511), Buffer.alloc(512)]));
}
test('packaging target matrix pins native artifacts for every selected OS and architecture', () => {
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'] as const) {
    const specs = targetPackages(target);
    expect(specs.codex.version).toEndWith(target);
    expect(specs.claude.name).toEndWith(target);
  }
  expect(targetPackages('linux-x64').keyring.name).toEndWith('linux-x64-gnu');
});
test('registry integrity verification fails on any changed native bytes', () => {
  const bytes = Buffer.from('native-runtime');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  expect(() => verifyIntegrity(bytes, integrity)).not.toThrow();
  expect(() => verifyIntegrity(Buffer.from('changed'), integrity)).toThrow('integrity mismatch');
});
test('native package extraction rejects traversal and links before writes', () => {
  expect(readNpmTarball(tar('package/bin/runtime'))[0]!.path).toBe('bin/runtime');
  for (const path of ['package/../escape', '/absolute', 'package/a\\b', 'package/C:/file'])
    expect(() => readNpmTarball(tar(path))).toThrow();
  expect(() => readNpmTarball(tar('package/link', '2'))).toThrow('link or special file');
});
test('runtime resources and instance endpoints cannot escape their trusted boundary', () => {
  expect(resourcePath('/safe/resources', 'runtimes/codex')).toBe('/safe/resources/runtimes/codex');
  for (const value of ['../secret', '/secret'])
    expect(() => resourcePath('/safe/resources', value)).toThrow();
  expect(validateLoopbackEndpoint('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234');
  for (const value of [
    'https://127.0.0.1',
    'http://localhost:1234',
    'http://127.0.0.1:1234/path',
    'http://user@127.0.0.1:1234',
  ])
    expect(() => validateLoopbackEndpoint(value)).toThrow();
});
