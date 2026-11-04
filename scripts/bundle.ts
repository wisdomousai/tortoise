import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROW_SCHEMA_VERSION } from '@tortoise/adapters/row-storage';
import {
  admissionRefusals,
  createBundle,
  generateSigningKey,
  requirementChanges,
  requirementsDigest,
  verifyBundle,
  type BundleRequirements,
  type SigningKey,
  type SiteApproval,
  type TrustedKey,
} from '@tortoise/bundle';
import { cycloneDx, type SecurityManifest } from '@tortoise/compliance';
import { loadManifest, readStarterConfig } from '@tortoise/host';
import { bestBeforeDate } from '@tortoise/kernel/build';
import { compileCli } from './build-cli';
import { artifacts } from './reference-artifacts';

const root = resolve(import.meta.dir, '..');
const usage = `bun scripts/bundle.ts keygen --out key.json
bun scripts/bundle.ts create --key key.json --out dir [--version v] [--target bun-linux-x64]
bun scripts/bundle.ts verify <dir> --trust key.pub.json
bun scripts/bundle.ts admit <dir> --trust key.pub.json [--installed dir] [--approval file] [--platform p]`;

function flag(args: string[], name: string, required = false) {
  const index = args.indexOf(`--${name}`);
  const value = index < 0 ? undefined : args[index + 1];
  if (required && !value) throw new Error(`--${name} is required\n${usage}`);
  return value;
}
const readJson = async <T>(path: string) => JSON.parse(await readFile(resolve(path), 'utf8')) as T;
const trusted = async (path: string) => {
  const value = await readJson<TrustedKey | TrustedKey[]>(path);
  return Array.isArray(value) ? value : [value];
};

/** `keygen`: a signing key (mode 0600) and its public half beside it. Nothing is reused. */
async function keygen(args: string[]) {
  const out = resolve(flag(args, 'out', true)!);
  const key = await generateSigningKey();
  await writeFile(out, `${JSON.stringify(key)}\n`, { mode: 0o600, flag: 'wx' });
  const publicKey: TrustedKey = { keyId: key.keyId, publicKey: key.publicKey };
  await writeFile(out.replace(/\.json$/, '') + '.pub.json', `${JSON.stringify(publicKey)}\n`);
  console.log(JSON.stringify(publicKey));
}

/** The platform name for a Bun compile target, or this machine's. */
const platformOf = (target?: string) =>
  target ? target.replace(/^bun-/, '') : `${process.platform}-${process.arch}`;

/**
 * `create`: compile the configured application's CLI, copy the web build, write the security
 * manifest and contract from the catalog and an SBOM from the current lockfile, and sign. They are
 * built here rather than committed, so they describe exactly the code this bundle was built from.
 * The key comes only from `--key`.
 */
async function create(args: string[]) {
  const key = await readJson<SigningKey>(flag(args, 'key', true)!);
  const out = resolve(flag(args, 'out', true)!);
  const target = flag(args, 'target');
  const config = readStarterConfig(join(root, 'app.config.json'));
  const manifest = await loadManifest(config);
  const web = join(root, 'dist/web', manifest.id);
  if (!(await Bun.file(join(web, 'index.html')).exists()))
    throw new Error('No web build for this application in dist/web; run `bun run build:web` first');
  const payload = await mkdtemp(join(tmpdir(), 'tortoise-bundle-'));
  // One build time for the binary's stamp and the bundle, so both report the same best-before date.
  const createdAt = new Date().toISOString();
  try {
    await mkdir(join(payload, 'bin'));
    // As in build-cli.ts: `darwin` contains "win", so match the Windows names exactly.
    const windows = target ? target.includes('windows') : process.platform === 'win32';
    const binary = join(payload, 'bin', windows ? `${config.name}.exe` : config.name);
    await compileCli(binary, target, undefined, createdAt);
    await cp(web, join(payload, 'web'), { recursive: true });
    const reference = artifacts(manifest);
    const contract = reference.get('contract.json')!;
    const securityText = reference.get('security-manifest.json')!;
    await writeFile(join(payload, 'contract.json'), contract);
    await writeFile(join(payload, 'security-manifest.json'), securityText);
    const security = JSON.parse(securityText) as BundleRequirements & SecurityManifest;
    const version =
      flag(args, 'version') ?? (await readJson<{ version: string }>('package.json')).version;
    const sbom = cycloneDx({
      application: manifest.id,
      version,
      lock: await readFile(join(root, 'bun.lock'), 'utf8'),
      manifest: security,
    });
    await writeFile(join(payload, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
    const bundle = await createBundle(
      payload,
      out,
      {
        application: manifest.id,
        version,
        createdAt,
        ...(manifest.shelfLifeDays
          ? { bestBefore: bestBeforeDate(createdAt, manifest.shelfLifeDays) }
          : {}),
        platform: platformOf(target),
        storageSchema: ROW_SCHEMA_VERSION,
        catalogDigest: createHash('sha256').update(contract).digest('hex'),
        requirements: {
          network: security.network,
          devices: security.devices,
          processes: security.processes,
          ...(security.os ? { os: security.os } : {}),
        },
      },
      key,
    );
    console.log(
      JSON.stringify({ bundle: out, application: bundle.application, files: bundle.files.length }),
    );
  } finally {
    await rm(payload, { recursive: true, force: true });
  }
}

/** `verify` and `admit`: exit 1 with the reasons when a bundle is refused. */
async function check(args: string[], admit: boolean) {
  const bundle = resolve(args[0] ?? '');
  const keys = await trusted(flag(args, 'trust', true)!);
  const manifest = await verifyBundle(bundle, keys);
  if (!admit)
    return console.log(
      JSON.stringify({
        verified: true,
        version: manifest.version,
        ...(manifest.bestBefore ? { bestBefore: manifest.bestBefore } : {}),
      }),
    );
  const installedPath = flag(args, 'installed');
  const installed = installedPath ? await verifyBundle(resolve(installedPath), keys) : undefined;
  const approvalPath = flag(args, 'approval');
  const approval = approvalPath ? await readJson<SiteApproval>(approvalPath) : undefined;
  const site = {
    platform: flag(args, 'platform') ?? platformOf(),
    storageSchemas: [ROW_SCHEMA_VERSION],
  };
  const refusals = admissionRefusals(manifest, site, installed, approval);
  console.log(
    JSON.stringify({
      admitted: refusals.length === 0,
      refusals,
      changes: requirementChanges(installed?.requirements, manifest.requirements),
      // What a site approval names to admit exactly these requirements.
      approval: {
        application: manifest.application,
        requirementsDigest: requirementsDigest(manifest.requirements),
      },
    }),
  );
  if (refusals.length) process.exitCode = 1;
}

if (import.meta.main) {
  const [verb, ...args] = process.argv.slice(2);
  try {
    if (verb === 'keygen') await keygen(args);
    else if (verb === 'create') await create(args);
    else if (verb === 'verify') await check(args, false);
    else if (verb === 'admit') await check(args, true);
    else throw new Error(usage);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
