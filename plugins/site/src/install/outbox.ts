import { join } from 'node:path';
import { PENDING_EXIT_CODE } from '@agent-native/adapters/cli';
import { verifyBundle, type BundleManifest, type TrustedKey } from '@agent-native/bundle';
import { ApplicationError } from '@agent-native/contracts';
import type { ApplicationManifest } from '@agent-native/host/manifest';
import { binaryOf, type InstallLayout, type InstallRecord } from './layout';
import { spawnCommand } from './native';

/** One target's effects that a purge would delete: undelivered, held or awaiting its decision. */
export interface RemainingEffects {
  readonly target: string;
  readonly pending: number;
  readonly held: number;
  readonly upstream: number;
}

const refuse = (message: string) => new ApplicationError('CONFLICT', message);
const declares = (manifest: ApplicationManifest, key: string) =>
  (manifest.plugins ?? []).some((plugin) =>
    plugin.settings?.some((setting) => setting.key === key),
  );
const lastLine = (text: string): unknown => {
  try {
    return JSON.parse(text.trim().split('\n').at(-1) || 'null');
  } catch {
    return undefined;
  }
};

/**
 * What the workspace outbox still holds, read by the installed release's own `drain`: that
 * binary knows its targets and effect types, which the binary running `site uninstall` may not.
 * The release is verified against the trusted keys first, since it runs with the installer's
 * rights. `drain` delivers what it can before counting, with the site policy and audit log the
 * service uses, and refuses while a running service owns the workspace.
 */
export async function remainingEffects(
  manifest: ApplicationManifest,
  layout: InstallLayout,
  record: InstallRecord,
  trusted: readonly TrustedKey[],
): Promise<RemainingEffects[]> {
  const release = layout.release(record.version);
  let bundle: BundleManifest;
  try {
    bundle = await verifyBundle(release, trusted);
  } catch (error) {
    throw refuse(
      `The installed release does not verify, so its outbox was not read: ${(error as Error).message}`,
    );
  }
  const drained = spawnCommand([
    join(release, binaryOf(bundle)),
    'drain',
    '--workspace',
    layout.workspace,
    ...(declares(manifest, 'site-policy') ? ['--site-policy', layout.policy] : []),
    ...(declares(manifest, 'audit-log') ? ['--audit-log', layout.audit] : []),
  ]);
  const report = lastLine(drained.stdout) as
    { targets?: RemainingEffects[]; error?: { message?: string } } | undefined;
  if (drained.exitCode !== 0 && drained.exitCode !== PENDING_EXIT_CODE)
    throw refuse(
      `The installed release could not read its outbox: ${report?.error?.message ?? drained.stderr.trim()}`,
    );
  if (!Array.isArray(report?.targets)) throw refuse('The installed release reported no outbox');
  return report.targets
    .map(({ target, pending, held, upstream }) => ({ target, pending, held, upstream }))
    .filter((target) => target.pending + target.held + target.upstream > 0);
}

/** The refusal an operator reads: per target, what would be lost, and the ways forward. */
export function undeliveredRefusal(remaining: readonly RemainingEffects[]) {
  const counts = remaining
    .map(({ target, pending, held, upstream }) => {
      const parts = [
        pending ? `${pending} pending` : '',
        held ? `${held} held for reconciliation` : '',
        upstream ? `${upstream} awaiting the target's decision` : '',
      ].filter(Boolean);
      return `${target}: ${parts.join(', ')}`;
    })
    .join('; ');
  return new ApplicationError(
    'CONFLICT',
    `Purging would delete effects the systems of record have not settled (${counts}). Start the service to deliver them and decide held ones, or pass --discard-undelivered`,
    { remaining: remaining.map((target) => ({ ...target })) },
  );
}
