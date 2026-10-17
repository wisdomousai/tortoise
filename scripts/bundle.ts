import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROW_SCHEMA_VERSION } from '@agent-native/adapters/row-storage';
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
} from '@agent-native/bundle';
import { loadManifest, readStarterConfig } from '@agent-native/host';
import { compileCli } from './build-cli';

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
 * `create`: compile the configured application's CLI, copy the web build and the generated
 * security manifest, SBOM and contract, and sign. The key comes only from `--key`.
 */
async function create(args: string[]) {
  const key = await readJson<SigningKey>(flag(args, 'key', true)!);
  const out = resolve(flag(args, 'out', true)!);
  const target = flag(args, 'target');
  const config = readStarterConfig(join(root, 'app.config.json'));
  const manifest = await loadManifest(config);
  const reference = join(root, 'docs/reference', manifest.id);
  const web = join(root, 'dist/web', manifest.id);
  if (!(await Bun.file(join(web, 'index.html')).exists()))
    throw new Error('No web build for this application in dist/web; run `bun run build:web` first');
  const payload = await mkdtemp(join(tmpdir(), 'agent-native-bundle-'));
  try {
    await mkdir(join(payload, 'bin'));
    const windows = (target ?? process.platform).includes('win');
    await compileCli(join(payload, 'bin', windows ? `${config.name}.exe` : config.name), target);
    await cp(web, join(payload, 'web'), { recursive: true });
    for (const file of ['security-manifest.json', 'sbom.cdx.json', 'contract.json'])
      await cp(join(reference, file), join(payload, file));
    const security = await readJson<BundleRequirements>(join(reference, 'security-manifest.json'));
    const contract = await readFile(join(reference, 'contract.json'));
    const bundle = await createBundle(
      payload,
      out,
      {
        application: manifest.id,
        version:
          flag(args, 'version') ?? (await readJson<{ version: string }>('package.json')).version,
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
  if (!admit) return console.log(JSON.stringify({ verified: true, version: manifest.version }));
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
