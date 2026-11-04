import { ApplicationError } from '@tortoise/contracts';
import { exitCodes, takeFlag } from '@tortoise/adapters/cli';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import type { PluginCommand } from '@tortoise/host/plugin';
import { installUsage, installVerb } from './install/cli';
import { policyErrors, deploymentPolicyFor } from './policy-file';

/** `policy check` or `network export` found error findings: the policy is invalid input. */
export const POLICY_REJECTED_EXIT_CODE = exitCodes.INVALID_INPUT;

export const deploymentUsage = (
  program: string,
) => `Deployment policy (offline; no instance or workspace needed):
  ${program} policy check --policy file                validate a deployment policy against the declared requirements
${installUsage(program)}`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);

async function policyCheck(manifest: ApplicationManifest, args: string[]) {
  const file = takeFlag(args, 'policy');
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
  if (!file) throw usage('policy check requires --policy');
  const policy = await deploymentPolicyFor(manifest, file);
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
 * `policy check` for one application's manifest: the findings startup refuses on, without opening
 * a workspace. `install`, `status` and `uninstall` place, report and remove the release of the
 * application this binary carries. Returns undefined for any other verb.
 */
export async function deploymentCommand(
  manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb === 'install' || verb === 'status' || verb === 'uninstall')
    return installVerb(manifest, verb, args.slice(1));
  if (verb !== 'policy') return undefined;
  if (sub === 'check') return policyCheck(manifest, rest);
  throw usage('Unknown policy command; see help');
}

/** The verb as a plugin command, added to every CLI of an application composing the plugin. */
export const deploymentCliCommand: PluginCommand = {
  usage: deploymentUsage,
  run: deploymentCommand,
};
