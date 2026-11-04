import { createHash } from 'node:crypto';
import { canonicalJson } from '@tortoise/contracts';
import type { BundleManifest, BundleRequirements } from './manifest';

/** One way a candidate reaches or runs more than the installed bundle. */
export interface RequirementChange {
  readonly kind: 'network' | 'device' | 'process' | 'os-handler' | 'os-action';
  readonly id: string;
  readonly change: 'added' | 'widened';
  readonly detail?: string;
}
/** What the site decided: the exact requirements digest it approved for one application. */
export interface SiteApproval {
  readonly application: string;
  readonly requirementsDigest: string;
}
/** The host a bundle would run on. */
export interface SiteTarget {
  readonly platform: string;
  /** Storage schema versions this site's storage reads. */
  readonly storageSchemas: readonly number[];
}

const scopeRank: Record<string, number> = { loopback: 0, site: 1, internet: 2 };

export const requirementsDigest = (requirements: BundleRequirements) =>
  createHash('sha256').update(canonicalJson(requirements)).digest('hex');

function byId<T extends { id: string }>(list: readonly T[] | undefined) {
  return new Map((list ?? []).map((entry) => [entry.id, entry]));
}

/**
 * Every requirement the candidate adds or widens against `installed` (none on a first install,
 * so everything is added). A destination widens when its scope rank rises or its direction, host,
 * protocol or port changes; a process when its executable changes. Removals are not listed.
 */
export function requirementChanges(
  installed: BundleRequirements | undefined,
  candidate: BundleRequirements,
): RequirementChange[] {
  const changes: RequirementChange[] = [];
  const before = byId(installed?.network);
  for (const next of candidate.network) {
    const old = before.get(next.id);
    if (!old) changes.push({ kind: 'network', id: next.id, change: 'added', detail: next.scope });
    else if ((scopeRank[next.scope] ?? 3) > (scopeRank[old.scope] ?? 3))
      changes.push({ kind: 'network', id: next.id, change: 'widened', detail: next.scope });
    else if (
      old.direction !== next.direction ||
      old.host !== next.host ||
      old.protocol !== next.protocol ||
      old.port !== next.port
    )
      changes.push({ kind: 'network', id: next.id, change: 'widened', detail: 'endpoint' });
  }
  const added = (kind: RequirementChange['kind'], old: Map<string, unknown>, ids: string[]) => {
    for (const id of ids) if (!old.has(id)) changes.push({ kind, id, change: 'added' });
  };
  added(
    'device',
    byId(installed?.devices),
    candidate.devices.map((entry) => entry.id),
  );
  const processes = byId(installed?.processes);
  for (const next of candidate.processes) {
    const old = processes.get(next.id);
    if (!old) changes.push({ kind: 'process', id: next.id, change: 'added' });
    else if (old.executable !== next.executable)
      changes.push({ kind: 'process', id: next.id, change: 'widened', detail: next.executable });
  }
  const handlers = (candidate.os?.handlers ?? []).map((entry) => entry.id);
  added('os-handler', byId(installed?.os?.handlers), handlers);
  const actions = byId(installed?.os?.actions);
  for (const next of candidate.os?.actions ?? []) {
    const old = actions.get(next.id);
    if (!old) changes.push({ kind: 'os-action', id: next.id, change: 'added' });
    else if (old.reaches !== next.reaches)
      changes.push({ kind: 'os-action', id: next.id, change: 'widened', detail: next.reaches });
  }
  return changes;
}

/** Why a verified bundle may not be installed here; an empty list admits it. */
export function admissionRefusals(
  candidate: BundleManifest,
  site: SiteTarget,
  installed?: BundleManifest,
  approval?: SiteApproval,
): string[] {
  const refusals: string[] = [];
  if (candidate.platform !== site.platform)
    refusals.push(`Built for ${candidate.platform}, not ${site.platform}`);
  if (!site.storageSchemas.includes(candidate.storageSchema))
    refusals.push(`Storage schema ${candidate.storageSchema} is not readable here`);
  if (installed && installed.application !== candidate.application)
    refusals.push(`Installed application is ${installed.application}`);
  const changes = requirementChanges(installed?.requirements, candidate.requirements);
  // An approval names the exact requirements, so approving one widening never covers the next.
  const approved =
    approval?.application === candidate.application &&
    approval.requirementsDigest === requirementsDigest(candidate.requirements);
  if (changes.length && !approved)
    refusals.push(
      `Requirements widen without site approval: ${changes.map((change) => `${change.kind} ${change.id} ${change.change}`).join(', ')}`,
    );
  return refusals;
}
