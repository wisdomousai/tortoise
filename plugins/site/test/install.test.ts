import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { createBundle, generateSigningKey, type SigningKey } from '@agent-native/bundle';

/**
 * `site install` end to end on a staged prefix: the bundles' binaries are scripts running the
 * fixture CLI, so the release's own `network export` and `migrate` run as they would on a site.
 * Nothing here loads a service; the OS steps run only with --apply.
 */
const fixtures = join(import.meta.dir, 'fixtures');
const cli = join(fixtures, 'install-cli.ts');
const policy = join(fixtures, 'site-policy.json');
const platform = `${process.platform}-${process.arch}`;
let directory = '';
let key: SigningKey;
let trust = '';
let prefix = '';
const requirements = {
  network: [],
  devices: [],
  processes: [{ id: 'helper', executable: 'helper' }],
};

async function bundle(version: string, state: number) {
  const payload = join(directory, `payload-${version}`);
  await mkdir(join(payload, 'bin'), { recursive: true });
  const bin = join(payload, 'bin', 'counter-site');
  await writeFile(
    bin,
    `#!/bin/sh\nFIXTURE_STATE=${state} exec "${process.execPath}" "${cli}" "$@"\n`,
  );
  await chmod(bin, 0o755);
  await writeFile(join(payload, 'web.html'), '<html></html>');
  const out = join(directory, `bundle-${version}`);
  await createBundle(
    payload,
    out,
    {
      application: 'counter-site',
      version,
      platform,
      storageSchema: 2,
      catalogDigest: 'a'.repeat(64),
      requirements,
    },
    key,
  );
  return out;
}

async function site(args: string[]) {
  const child = Bun.spawn([process.execPath, cli, 'site', ...args, '--prefix', prefix], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FIXTURE_STATE: '1' },
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, result: JSON.parse(stdout.trim().split('\n').at(-1) || '{}'), stderr };
}
const install = (bundlePath: string, extra: string[] = []) =>
  site([
    'install',
    bundlePath,
    '--trust',
    trust,
    '--site-policy',
    policy,
    '--service',
    'systemd',
    ...extra,
  ]);
const app = (path: string) => join(prefix, path, 'counter-site');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'site-install-'));
  prefix = join(directory, 'root');
  key = await generateSigningKey();
  trust = join(directory, 'key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('install places a verified release, renders the unit and firewall rules, and switches current', async () => {
  const v1 = await bundle('1.0.0', 1);
  // A first install needs a site approval of exactly the bundle's requirements.
  const refused = await install(v1);
  expect(refused.code).not.toBe(0);
  expect(refused.result.error.message).toContain('without site approval');
  const { result: admit } = await site(['status', '--trust', trust]);
  expect(admit).toMatchObject({ installed: false });

  const approval = join(directory, 'approval.json');
  const { requirementsDigest } = await import('@agent-native/bundle');
  await writeFile(
    approval,
    JSON.stringify({
      application: 'counter-site',
      requirementsDigest: requirementsDigest(requirements),
    }),
  );
  const first = await install(v1, ['--approval', approval]);
  expect(first.code).toBe(0);
  expect(first.result).toMatchObject({
    installed: true,
    version: '1.0.0',
    service: 'systemd',
    firewallTable: 'counter_site',
  });

  const current = join(app('opt/agent-native'), 'current');
  expect(await readlink(current)).toBe(join(app('opt/agent-native'), 'releases', '1.0.0'));
  const unit = await readFile(
    join(prefix, 'etc/systemd/system/agent-native-counter-site.service'),
    'utf8',
  );
  expect(unit).toContain(`ExecStart=${join(current, 'files/bin/counter-site')} serve`);
  expect(unit).toContain(`--workspace ${join(app('var/lib/agent-native'), 'workspace')}`);
  expect(unit).toContain('IPAddressDeny=any');
  expect(await readFile(join(app('etc/agent-native'), 'egress.nft'), 'utf8')).toContain(
    'table inet counter_site {',
  );
  expect((await lstat(join(app('var/lib/agent-native'), 'workspace'))).mode & 0o777).toBe(0o700);
  expect((await lstat(join(app('etc/agent-native'), 'site-policy.json'))).mode & 0o777).toBe(0o640);
  expect((await site(['status', '--trust', trust])).result).toMatchObject({
    installed: true,
    version: '1.0.0',
    verified: true,
  });
  // Native smoke on a Linux runner (CI sets it): systemd and the kernel parse what was written.
  if (process.env.SITE_INSTALL_NATIVE === '1') {
    const unitPath = join(prefix, 'etc/systemd/system/agent-native-counter-site.service');
    const verify = Bun.spawnSync(['systemd-analyze', 'verify', unitPath], { stderr: 'pipe' });
    if (verify.exitCode !== 0) throw new Error(verify.stderr.toString());
    const rules = join(app('etc/agent-native'), 'egress.nft');
    // nft resolves the `meta skuid` user name while parsing, so the service account must exist,
    // as install creates it before loading the rules.
    const user = /meta skuid != "([^"]+)"/.exec(await readFile(rules, 'utf8'))![1]!;
    Bun.spawnSync([
      'sudo',
      'sh',
      '-c',
      `id -u ${user} || useradd --system --no-create-home ${user}`,
    ]);
    const check = Bun.spawnSync(['sudo', 'nft', '-c', '-f', rules], { stderr: 'pipe' });
    if (check.exitCode !== 0) throw new Error(check.stderr.toString());
  }
});

test('an upgrade migrates the workspace with the new release before switching, and keeps data', async () => {
  // Version 1 commits state, as the service would.
  const workspace = join(app('var/lib/agent-native'), 'workspace');
  const binary = join(app('opt/agent-native'), 'current', 'files/bin/counter-site');
  const bumped = Bun.spawnSync([binary, 'counter.bump', '--embedded', '--workspace', workspace]);
  expect(bumped.exitCode).toBe(0);

  const v2 = await bundle('2.0.0', 2);
  const upgrade = await install(v2);
  expect(upgrade.code).toBe(0);
  expect(upgrade.result).toMatchObject({ version: '2.0.0', previous: '1.0.0' });
  const storage = new SQLiteStorage<Record<string, unknown>>(
    join(workspace, 'workspace.sqlite'),
    () => ({}),
  );
  try {
    await storage.read('local', async (snapshot) => {
      expect(snapshot.state.counter).toEqual({ total: 1 });
      expect(snapshot.stateVersions?.application?.version).toBe(2);
    });
  } finally {
    await storage.close();
  }
  // Both releases stay on disk; current names the new one.
  expect(await readlink(join(app('opt/agent-native'), 'current'))).toEndWith('releases/2.0.0');
});

test('a tampered release or bundle is refused, and uninstall keeps data unless purged', async () => {
  const release = join(app('opt/agent-native'), 'releases', '2.0.0');
  await writeFile(join(release, 'files', 'web.html'), '<html>changed</html>');
  const status = await site(['status', '--trust', trust]);
  expect(status.code).toBe(1);
  expect(status.result).toMatchObject({ verified: false });

  const v3 = await bundle('3.0.0', 2);
  await writeFile(join(v3, 'files', 'web.html'), 'tampered');
  expect((await install(v3)).code).not.toBe(0);
  expect(await readlink(join(app('opt/agent-native'), 'current'))).toEndWith('releases/2.0.0');

  expect((await site(['uninstall'])).result).toMatchObject({ removed: true, purged: false });
  expect((await site(['status', '--trust', trust])).result).toMatchObject({ installed: false });
  expect(
    await Bun.file(join(prefix, 'etc/systemd/system/agent-native-counter-site.service')).exists(),
  ).toBe(false);
  expect(
    await Bun.file(join(app('var/lib/agent-native'), 'workspace', 'workspace.sqlite')).exists(),
  ).toBe(true);
}, 30_000);
