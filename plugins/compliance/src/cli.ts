import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApplicationError } from '@tortoise/contracts';
import { takeFlag } from '@tortoise/adapters/cli';
import { AUDIT_INVALID_EXIT_CODE } from '@tortoise/audit/cli';
import { readEvents, verifyEventLog } from '@tortoise/event-log';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import type { PluginCommand } from '@tortoise/host/plugin';
import { deploymentPolicyFor } from '@tortoise/deployment/policy-file';
import { accumulateEgress, assessPosture, postureMarkdown } from './posture';

export const complianceUsage = (
  program: string,
) => `Compliance (offline; no instance or workspace needed):
  ${program} compliance report --log dir [--policy file] [--format markdown|json] [--out file]
      posture, destinations and recent denials from a log (exit ${AUDIT_INVALID_EXIT_CODE} if failing)
`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);

/** The digests the last `config.loaded` event attested, when present. */
function attestedDigests(data: Readonly<Record<string, unknown>>) {
  return {
    ...(typeof data.catalogDigest === 'string' ? { catalogDigest: data.catalogDigest } : {}),
    ...(typeof data.executableDigest === 'string'
      ? { executableDigest: data.executableDigest }
      : {}),
  };
}

async function complianceReport(manifest: ApplicationManifest, args: string[]) {
  const log = takeFlag(args, 'log');
  const file = takeFlag(args, 'policy');
  const format = takeFlag(args, 'format') ?? 'markdown';
  const out = takeFlag(args, 'out');
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
  if (!log) throw usage('compliance report requires --log');
  if (format !== 'markdown' && format !== 'json') throw usage('--format must be markdown or json');
  const directory = resolve(log);
  const [policy, verification, events] = await Promise.all([
    deploymentPolicyFor(manifest, file),
    verifyEventLog(directory),
    readEvents(directory),
  ]);
  const attested = events.findLast((event) => event.kind === 'config.loaded')?.data ?? {};
  const posture = assessPosture({
    policy,
    verification,
    usage: accumulateEgress(new Map(), events),
    attestation: attestedDigests(attested),
    // The log attests the best-before date of the build that wrote it.
    ...(typeof attested.bestBefore === 'string' ? { bestBefore: attested.bestBefore } : {}),
    now: Date.now(),
  });
  const denials = events.filter((event) => event.outcome === 'denied').slice(-50);
  const text =
    format === 'json'
      ? `${JSON.stringify({ posture, denials }, null, 2)}\n`
      : postureMarkdown(posture, { application: manifest.id, denials });
  if (out) await writeFile(resolve(out), text, { mode: 0o644 });
  else process.stdout.write(text);
  return posture.status === 'failing' ? AUDIT_INVALID_EXIT_CODE : 0;
}

/**
 * `compliance report` for one application's manifest: the posture an auditor reads at runtime,
 * computed offline from a log directory (possibly a copy) and a policy file. Returns undefined
 * when `args` is not a `compliance` verb.
 */
export async function complianceCommand(
  manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb !== 'compliance') return undefined;
  if (sub === 'report') return complianceReport(manifest, rest);
  throw usage('Unknown compliance command; see help');
}

/** The verb as a plugin command, added to every CLI of an application composing the plugin. */
export const complianceCliCommand: PluginCommand = {
  usage: complianceUsage,
  run: complianceCommand,
};
