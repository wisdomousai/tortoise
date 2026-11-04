import { resolve } from 'node:path';
import { ApplicationError } from '@tortoise/contracts';
import { takeFlag } from '@tortoise/adapters/cli';
import { verifyEventLog } from '@tortoise/event-log';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import type { PluginCommand } from '@tortoise/host/plugin';

/** `audit verify` found the chain damaged. Distinct from operation errors (0–8) and 75. */
export const AUDIT_INVALID_EXIT_CODE = 10;

export const auditUsage = (
  program: string,
) => `Audit log (offline; no instance or workspace needed):
  ${program} audit verify --log dir [--anchor-seq n --anchor-hash h]   check the hash chain (exit ${AUDIT_INVALID_EXIT_CODE} if damaged)
`;

const usage = (message: string) => new ApplicationError('INVALID_INPUT', message);

async function auditVerify(args: string[]) {
  const log = takeFlag(args, 'log');
  const anchorSeq = takeFlag(args, 'anchor-seq');
  const anchorHash = takeFlag(args, 'anchor-hash');
  if (args.length) throw usage(`Unexpected argument "${args[0]}"`);
  if (!log) throw usage('audit verify requires --log');
  if ((anchorSeq === undefined) !== (anchorHash === undefined))
    throw usage('--anchor-seq and --anchor-hash are used together');
  const report = await verifyEventLog(resolve(log), {
    ...(anchorSeq !== undefined ? { anchor: { seq: Number(anchorSeq), hash: anchorHash! } } : {}),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok && report.events > 0 ? 0 : AUDIT_INVALID_EXIT_CODE;
}

/**
 * `audit verify` against a log directory, which may be a copy taken off the host. It opens no
 * workspace and no instance. Returns undefined when `args` is not an `audit` verb.
 */
export async function auditCommand(
  _manifest: ApplicationManifest,
  args: string[],
): Promise<number | undefined> {
  const [verb, sub, ...rest] = args;
  if (verb !== 'audit') return undefined;
  if (sub === 'verify') return auditVerify(rest);
  throw usage('Unknown audit command; see help');
}

/** The verb as a plugin command, added to every CLI of an application composing the plugin. */
export const auditCliCommand: PluginCommand = { usage: auditUsage, run: auditCommand };
