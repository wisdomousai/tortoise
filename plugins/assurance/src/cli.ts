import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { exitCodes, takeFlag } from '@agent-native/adapters/cli';
import { isolatedPolicy, loadSitePolicy, type ResolvedPolicy } from '@agent-native/egress';
import { readEvents, verifyEventLog } from '@agent-native/event-log';
import { deploymentRequirements } from '@agent-native/host/components';
import type { ApplicationManifest } from '@agent-native/host/manifest';
import type { PluginCommand } from '@agent-native/host/plugin';
import { exportFormats, exportRules, type ExportFormat } from './exporters';
import { accumulateEgress, assessPosture, postureMarkdown } from './posture';
import { networkRules } from './rules';

/** `audit verify` found the chain damaged. Distinct from operation errors (0–8) and 75. */
export const AUDIT_INVALID_EXIT_CODE = 10;
/** `security check` or `export` found error findings: the policy is invalid input. */
export const POLICY_REJECTED_EXIT_CODE = exitCodes.INVALID_INPUT;

export const assuranceUsage = (
  program: string,
) => `Assurance (offline; no authority or workspace needed):
  ${program} security check --site file           validate a site policy against the declared requirements
  ${program} security export [--site file] --format ${exportFormats.join('|')}
      [--resolver ip]... [--user name] [--executable path] [--workspace dir] [--audit-log dir]
      [--image ref] [--out file]                  OS, orchestrator and service rules from the policy
  ${program} audit verify --log dir [--anchor-seq n --anchor-hash h]   check the hash chain (exit ${AUDIT_INVALID_EXIT_CODE} if damaged)
  ${program} audit report --log dir [--site file] [--format markdown|json] [--out file]
`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);
function rejectRemaining(args: string[]) {
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
}
function takeAll(args: string[], name: string) {
  const values: string[] = [];
  for (let value = takeFlag(args, name); value !== undefined; value = takeFlag(args, name))
    values.push(value);
  return values;
}
async function policyOf(
  manifest: ApplicationManifest,
  site: string | undefined,
): Promise<ResolvedPolicy> {
  const requirements = deploymentRequirements(manifest);
  return site ? loadSitePolicy(resolve(site), requirements) : isolatedPolicy(requirements);
}
const errorsOf = (policy: ResolvedPolicy) =>
  policy.findings.filter((finding) => finding.level === 'error');
async function emit(text: string, out: string | undefined) {
  if (out) await writeFile(resolve(out), text, { mode: 0o644 });
  else process.stdout.write(text);
}

async function securityCheck(manifest: ApplicationManifest, args: string[]) {
  const site = takeFlag(args, 'site');
  rejectRemaining(args);
  if (!site) throw usage('security check requires --site');
  const policy = await policyOf(manifest, site);
  process.stdout.write(
    `${JSON.stringify({
      ok: errorsOf(policy).length === 0,
      profile: policy.profile,
      mode: policy.mode,
      digest: policy.digest,
      bound: [...policy.bindings.keys()].sort(),
      disabled: [...policy.disabled].sort(),
      findings: policy.findings,
      consequences: policy.consequences,
    })}\n`,
  );
  return errorsOf(policy).length ? POLICY_REJECTED_EXIT_CODE : 0;
}

async function securityExport(manifest: ApplicationManifest, args: string[]) {
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
  rejectRemaining(args);
  if (!format || !exportFormats.includes(format as ExportFormat))
    throw usage(`--format must be one of ${exportFormats.join(', ')}`);
  const policy = await policyOf(manifest, site);
  // Same refusal as startup: never export rules for a policy the service would not run.
  if (errorsOf(policy).length) {
    process.stderr.write(
      `Site policy rejected:\n${errorsOf(policy)
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
  await emit(exportRules(rules, format as ExportFormat, defined), out);
  return 0;
}

async function auditVerify(args: string[]) {
  const log = takeFlag(args, 'log');
  const anchorSeq = takeFlag(args, 'anchor-seq');
  const anchorHash = takeFlag(args, 'anchor-hash');
  rejectRemaining(args);
  if (!log) throw usage('audit verify requires --log');
  if ((anchorSeq === undefined) !== (anchorHash === undefined))
    throw usage('--anchor-seq and --anchor-hash are used together');
  const report = await verifyEventLog(resolve(log), {
    ...(anchorSeq !== undefined ? { anchor: { seq: Number(anchorSeq), hash: anchorHash! } } : {}),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok && report.events > 0 ? 0 : AUDIT_INVALID_EXIT_CODE;
}

async function auditReport(manifest: ApplicationManifest, args: string[]) {
  const log = takeFlag(args, 'log');
  const site = takeFlag(args, 'site');
  const format = takeFlag(args, 'format') ?? 'markdown';
  const out = takeFlag(args, 'out');
  rejectRemaining(args);
  if (!log) throw usage('audit report requires --log');
  if (format !== 'markdown' && format !== 'json') throw usage('--format must be markdown or json');
  const directory = resolve(log);
  const [policy, verification, events] = await Promise.all([
    policyOf(manifest, site),
    verifyEventLog(directory),
    readEvents(directory),
  ]);
  const attested = events.findLast((event) => event.kind === 'config.loaded')?.data ?? {};
  const posture = assessPosture({
    policy,
    verification,
    usage: accumulateEgress(new Map(), events),
    attestation: {
      ...(typeof attested.catalogDigest === 'string'
        ? { catalogDigest: attested.catalogDigest }
        : {}),
      ...(typeof attested.executableDigest === 'string'
        ? { executableDigest: attested.executableDigest }
        : {}),
    },
    now: Date.now(),
  });
  const denials = events.filter((event) => event.outcome === 'denied').slice(-50);
  await emit(
    format === 'json'
      ? `${JSON.stringify({ posture, denials }, null, 2)}\n`
      : postureMarkdown(posture, { application: manifest.id, denials }),
    out,
  );
  return posture.status === 'failing' ? AUDIT_INVALID_EXIT_CODE : 0;
}

/**
 * `security …` and `audit …` verbs for one application's manifest. They open no workspace and
 * no authority, so they work offline against a policy file or a copied log. Returns undefined
 * when `args` is not one of them.
 */
export async function assuranceCommand(
  manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb === 'security' && sub === 'check') return securityCheck(manifest, rest);
  if (verb === 'security' && sub === 'export') return securityExport(manifest, rest);
  if (verb === 'audit' && sub === 'verify') return auditVerify(rest);
  if (verb === 'audit' && sub === 'report') return auditReport(manifest, rest);
  if (verb === 'security' || verb === 'audit') throw usage(`Unknown ${verb} command; see help`);
  return undefined;
}

/** The verbs as a plugin command, added to every CLI of an application composing assurance. */
export const assuranceCliCommand: PluginCommand = {
  usage: assuranceUsage,
  run: assuranceCommand,
};
