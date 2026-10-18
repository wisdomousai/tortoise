import { ApplicationError } from '@agent-native/contracts';
import { exitCodes, takeFlag } from '@agent-native/adapters/cli';
import type { ApplicationManifest } from '@agent-native/host/manifest';
import type { PluginCommand } from '@agent-native/host/plugin';
import { installUsage, installVerb } from './install/cli';
import { policyErrors, sitePolicyFor } from './policy-file';

/** `site check` or `network export` found error findings: the policy is invalid input. */
export const POLICY_REJECTED_EXIT_CODE = exitCodes.INVALID_INPUT;

export const siteUsage = (
  program: string,
) => `Site policy (offline; no instance or workspace needed):
  ${program} site check --site file                validate a site policy against the declared requirements
${installUsage(program)}`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);

async function siteCheck(manifest: ApplicationManifest, args: string[]) {
  const site = takeFlag(args, 'site');
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
  if (!site) throw usage('site check requires --site');
  const policy = await sitePolicyFor(manifest, site);
  process.stdout.write(
    `${JSON.stringify({
      ok: policyErrors(policy).length === 0,
      profile: policy.profile,
      mode: policy.mode,
      digest: policy.digest,
      bound: [...policy.bindings.keys()].sort(),
      disabled: [...policy.disabled].sort(),
      findings: policy.findings,
      consequences: policy.consequences,
    })}\n`,
  );
  return policyErrors(policy).length ? POLICY_REJECTED_EXIT_CODE : 0;
}

/**
 * `site check` for one application's manifest: the findings startup refuses on, without opening
 * a workspace. Returns undefined when `args` is not a `site` verb.
 */
export async function siteCommand(
  manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb !== 'site') return undefined;
  if (sub === 'check') return siteCheck(manifest, rest);
  if (sub === 'install' || sub === 'status' || sub === 'uninstall')
    return installVerb(manifest, sub, rest);
  throw usage('Unknown site command; see help');
}

/** The verb as a plugin command, added to every CLI of an application composing the plugin. */
export const siteCliCommand: PluginCommand = { usage: siteUsage, run: siteCommand };
