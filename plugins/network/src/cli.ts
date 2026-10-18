import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { takeFlag } from '@agent-native/adapters/cli';
import { deploymentRequirements } from '@agent-native/host/components';
import type { ApplicationManifest } from '@agent-native/host/manifest';
import type { PluginCommand } from '@agent-native/host/plugin';
import { POLICY_REJECTED_EXIT_CODE } from '@agent-native/site/cli';
import { policyErrors, sitePolicyFor } from '@agent-native/site/policy-file';
import { exportFormats, exportRules, type ExportFormat } from './exporters';
import { networkRules } from './rules';

export const networkUsage = (
  program: string,
) => `Network (offline; no instance or workspace needed):
  ${program} network export [--site file] --format ${exportFormats.join('|')}
      [--resolver ip]... [--user name] [--executable path] [--workspace dir] [--audit-log dir]
      [--image ref] [--out file]                  OS, orchestrator and service rules from the policy
`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);
function takeAll(args: string[], name: string) {
  const values: string[] = [];
  for (let value = takeFlag(args, name); value !== undefined; value = takeFlag(args, name))
    values.push(value);
  return values;
}

async function networkExport(manifest: ApplicationManifest, args: string[]) {
  const site = takeFlag(args, 'site');
  const format = takeFlag(args, 'format');
  const resolvers = takeAll(args, 'resolver');
  const options = {
    user: takeFlag(args, 'user'),
    executable: takeFlag(args, 'executable'),
    workspace: takeFlag(args, 'workspace'),
    auditLog: takeFlag(args, 'audit-log'),
    image: takeFlag(args, 'image'),
    sitePolicy: site ? resolve(site) : undefined,
  };
  const out = takeFlag(args, 'out');
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
  if (!format || !exportFormats.includes(format as ExportFormat))
    throw usage(`--format must be one of ${exportFormats.join(', ')}`);
  const policy = await sitePolicyFor(manifest, site);
  // Same refusal as startup: never export rules for a policy the service would not run.
  if (policyErrors(policy).length) {
    process.stderr.write(
      `Site policy rejected:\n${policyErrors(policy)
        .map((finding) => `- ${finding.code}: ${finding.message}`)
        .join('\n')}\n`,
    );
    return POLICY_REJECTED_EXIT_CODE;
  }
  const rules = networkRules(policy, {
    application: manifest.id,
    resolvers,
    processes: deploymentRequirements(manifest).processes,
  });
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
  const text = exportRules(rules, format as ExportFormat, defined);
  if (out) await writeFile(resolve(out), text, { mode: 0o644 });
  else process.stdout.write(text);
  return 0;
}

/**
 * `network export` for one application's manifest: default-deny rules for a site policy, without
 * opening a workspace. Returns undefined when `args` is not a `network` verb.
 */
export async function networkCommand(
  manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb !== 'network') return undefined;
  if (sub === 'export') return networkExport(manifest, rest);
  throw usage('Unknown network command; see help');
}

/** The verb as a plugin command, added to every CLI of an application composing the plugin. */
export const networkCliCommand: PluginCommand = { usage: networkUsage, run: networkCommand };
