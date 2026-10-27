import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admissionRefusals,
  BundleRefused,
  createBundle,
  generateSigningKey,
  requirementChanges,
  requirementsDigest,
  verifyBundle,
  type BundleDescription,
  type BundleRequirements,
  type SigningKey,
} from '../src/index';

let directory = '';
let payload = '';
let key: SigningKey;

const requirements: BundleRequirements = {
  network: [
    { id: 'erp', direction: 'egress', scope: 'site', host: 'erp.local', protocol: 'https' },
  ],
  devices: [],
  processes: [{ id: 'helper', executable: 'helper' }],
  os: { handlers: [{ id: 'task.open' }], actions: [] },
};
const description = (overrides: Partial<BundleDescription> = {}): BundleDescription => ({
  application: 'line-station',
  version: '1.2.0',
  platform: 'linux-x64',
  storageSchema: 2,
  catalogDigest: 'a'.repeat(64),
  requirements,
  ...overrides,
});
const site = { platform: 'linux-x64', storageSchemas: [2] };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bundle-'));
  payload = join(directory, 'payload');
  await mkdir(join(payload, 'web'), { recursive: true });
  await writeFile(join(payload, 'app'), 'binary');
  await writeFile(join(payload, 'web', 'index.html'), '<html></html>');
  key = await generateSigningKey();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const build = (name: string, overrides: Partial<BundleDescription> = {}) =>
  createBundle(payload, join(directory, name), description(overrides), key);

test('a bundle verifies against its publisher key and lists every file', async () => {
  await build('ok');
  const manifest = await verifyBundle(join(directory, 'ok'), [key]);
  expect(manifest.files.map((file) => file.path)).toEqual(['app', 'web/index.html']);
  // The private key never enters the bundle.
  const signed = await readFile(join(directory, 'ok', 'bundle.sig'), 'utf8');
  expect(signed).not.toContain(key.privateKey);
});

test('a tampered file, an added file, a changed manifest or an unknown key is refused', async () => {
  const other = await generateSigningKey();
  await build('b');
  const bundle = join(directory, 'b');
  await expect(verifyBundle(bundle, [other])).rejects.toBeInstanceOf(BundleRefused);
  // A trusted entry whose ID belongs to another key does not verify either.
  await expect(
    verifyBundle(bundle, [{ keyId: key.keyId, publicKey: other.publicKey }]),
  ).rejects.toThrow('trusted key');
  await writeFile(join(bundle, 'files', 'extra'), 'x');
  await expect(verifyBundle(bundle, [key])).rejects.toThrow('differ');
  await rm(join(bundle, 'files', 'extra'));
  await writeFile(join(bundle, 'files', 'app'), 'replaced');
  await expect(verifyBundle(bundle, [key])).rejects.toThrow('digest');
  await writeFile(join(bundle, 'files', 'app'), 'binary');
  expect((await verifyBundle(bundle, [key])).version).toBe('1.2.0');
  const manifest = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'));
  manifest.requirements.network[0].scope = 'internet';
  await writeFile(join(bundle, 'bundle.json'), JSON.stringify(manifest));
  await expect(verifyBundle(bundle, [key])).rejects.toThrow('trusted key');
});

test('the best-before date is signed with the bundle, and a malformed one is refused', async () => {
  await build('dated', { bestBefore: '2027-04-25' });
  const bundle = join(directory, 'dated');
  expect((await verifyBundle(bundle, [key])).bestBefore).toBe('2027-04-25');
  expect((await build('undated')).bestBefore).toBeUndefined();
  const manifest = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'));
  manifest.bestBefore = '2099-01-01';
  await writeFile(join(bundle, 'bundle.json'), JSON.stringify(manifest));
  await expect(verifyBundle(bundle, [key])).rejects.toThrow('trusted key');
  await expect(build('malformed', { bestBefore: '25.04.2027' })).rejects.toThrow(
    'best-before date is invalid',
  );
});

test('a payload with a link, or a manifest path that escapes, is refused', async () => {
  await symlink('/etc/hosts', join(payload, 'hosts'));
  await expect(build('linked')).rejects.toThrow('link');
  await rm(join(payload, 'hosts'));
  const bundle = join(directory, 'escape');
  await build('escape');
  const manifest = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'));
  manifest.files[0].path = '../app';
  const { signManifest } = await import('../src/signing');
  await writeFile(join(bundle, 'bundle.json'), JSON.stringify(manifest));
  await writeFile(join(bundle, 'bundle.sig'), JSON.stringify(await signManifest(manifest, key)));
  await expect(verifyBundle(bundle, [key])).rejects.toThrow('file entry');
});

test('an incompatible platform, storage schema or application is refused', async () => {
  const installed = await build('installed');
  const approval = {
    application: 'line-station',
    requirementsDigest: requirementsDigest(requirements),
  };
  expect(admissionRefusals(installed, site, undefined, approval)).toEqual([]);
  const windows = await build('windows', { platform: 'win32-x64' });
  expect(admissionRefusals(windows, site, installed)).toEqual([
    'Built for win32-x64, not linux-x64',
  ]);
  const newer = await build('newer', { storageSchema: 3 });
  expect(admissionRefusals(newer, site, installed)).toEqual([
    'Storage schema 3 is not readable here',
  ]);
  const foreign = await build('foreign', { application: 'crm-capture' });
  expect(admissionRefusals(foreign, site, installed)[0]).toContain('Installed application');
});

test('widened requirements need a site approval for exactly those requirements', async () => {
  const installed = await build('v1');
  const widened: BundleRequirements = {
    ...requirements,
    network: [{ ...requirements.network[0]!, scope: 'internet' }],
    processes: [{ id: 'helper', executable: 'other-helper' }],
    os: { handlers: [{ id: 'task.open' }], actions: [{ id: 'share', reaches: 'mailto:' }] },
  };
  expect(requirementChanges(requirements, widened)).toEqual([
    { kind: 'network', id: 'erp', change: 'widened', detail: 'internet' },
    { kind: 'process', id: 'helper', change: 'widened', detail: 'other-helper' },
    { kind: 'os-action', id: 'share', change: 'added' },
  ]);
  const candidate = await build('v2', { version: '1.3.0', requirements: widened });
  expect(admissionRefusals(candidate, site, installed)[0]).toContain('without site approval');
  const stale = {
    application: 'line-station',
    requirementsDigest: requirementsDigest(requirements),
  };
  expect(admissionRefusals(candidate, site, installed, stale)).toHaveLength(1);
  const approved = { application: 'line-station', requirementsDigest: requirementsDigest(widened) };
  expect(admissionRefusals(candidate, site, installed, approved)).toEqual([]);
  // The same requirements, or narrower ones, need no approval.
  const same = await build('v3', { version: '1.3.1' });
  expect(admissionRefusals(same, site, installed)).toEqual([]);
  const narrower = await build('v4', { requirements: { ...requirements, processes: [] } });
  expect(admissionRefusals(narrower, site, installed)).toEqual([]);
});
