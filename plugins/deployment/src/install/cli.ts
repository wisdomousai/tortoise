import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InstallApproval, TrustedKey } from '@tortoise/bundle';
import { ApplicationError } from '@tortoise/contracts';
import { takeFlag } from '@tortoise/adapters/cli';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import { installBundle, installStatus, uninstall } from './install';
import type { ServiceManager } from './layout';

export const installUsage = (
  program: string,
) => `Install (run as root on the host the release runs on):
  ${program} install <bundle> --trust key.pub.json --deployment-policy file [--approval file]
      [--prefix dir] [--service systemd|windows|none] [--user name] [--apply]
                                                    verify, admit, place, migrate and switch a release
  ${program} status [--prefix dir] --trust key.pub.json   the active release and whether it still verifies
  ${program} uninstall [--prefix dir] [--apply]  remove the service and releases; the data stays
  ${program} uninstall --purge --trust key.pub.json [--discard-undelivered] [--prefix dir] [--apply]
                                                    also delete the data; refused while the outbox holds effects
`;

const invalid = (message: string) => new ApplicationError('INVALID_INPUT', message);
const required = (args: string[], name: string) => {
  const value = takeFlag(args, name);
  if (!value) throw invalid(`--${name} is required`);
  return resolve(value);
};
const has = (args: string[], name: string) => takeFlag(args, name, false) !== undefined;
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;
async function trustedKeys(path: string): Promise<TrustedKey[]> {
  const value = await readJson<TrustedKey | TrustedKey[]>(path);
  return Array.isArray(value) ? value : [value];
}
const defaultService = (): ServiceManager =>
  process.platform === 'linux' ? 'systemd' : process.platform === 'win32' ? 'windows' : 'none';
function serviceOf(value: string | undefined): ServiceManager {
  const service = value ?? defaultService();
  if (service !== 'systemd' && service !== 'windows' && service !== 'none')
    throw invalid('--service must be systemd, windows or none');
  return service;
}
/** The service account goes into shell commands and unit files, so only a plain name passes. */
function userOf(value: string | undefined) {
  const user = value ?? 'tortoise';
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) throw invalid('--user must be a plain account name');
  return user;
}
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
function rejectRemaining(args: string[]) {
  if (args.length) throw invalid(`Unexpected argument "${args[0]}"`);
}

/** `install`, `status` and `uninstall` for the application this binary carries. */
export async function installVerb(manifest: ApplicationManifest, verb: string, args: string[]) {
  const prefix = resolve(takeFlag(args, 'prefix') ?? '/');
  if (verb === 'install') {
    const trust = required(args, 'trust');
    const policy = required(args, 'deployment-policy');
    const approval = takeFlag(args, 'approval');
    const options = {
      prefix,
      policy,
      service: serviceOf(takeFlag(args, 'service')),
      user: userOf(takeFlag(args, 'user')),
      apply: has(args, 'apply'),
      platform: `${process.platform}-${process.arch}`,
      trusted: await trustedKeys(trust),
      ...(approval ? { approval: await readJson<InstallApproval>(resolve(approval)) } : {}),
    };
    const bundle = args.shift();
    if (!bundle) throw invalid('install requires a bundle directory');
    rejectRemaining(args);
    print({
      installed: true,
      ...(await installBundle(manifest, { ...options, bundle: resolve(bundle) })),
    });
    return 0;
  }
  if (verb === 'status') {
    const trusted = await trustedKeys(required(args, 'trust'));
    rejectRemaining(args);
    const status = await installStatus(manifest, prefix, trusted);
    print(status);
    return status.installed && !status.verified ? 1 : 0;
  }
  const trust = takeFlag(args, 'trust');
  const options = {
    prefix,
    apply: has(args, 'apply'),
    purge: has(args, 'purge'),
    discardUndelivered: has(args, 'discard-undelivered'),
    ...(trust ? { trusted: await trustedKeys(resolve(trust)) } : {}),
  };
  rejectRemaining(args);
  print(await uninstall(manifest, options));
  return 0;
}
