import { hostContext, type HostedApplication } from '@agent-native/kernel/application';
import type { SiteReport } from './contracts';

/**
 * This site's health as the fleet records it: the outbox counted by target the way `drain`
 * counts it (pending, held for reconciliation, acknowledged), read with the host's own
 * trusted identity, which needs no business grant. Payloads never leave: only counts do, with the
 * running build's best-before date when it has one.
 */
export async function siteReport(
  application: Pick<HostedApplication, 'pendingEffects'>,
  options: {
    readonly workspaceId: string;
    readonly application: string;
    readonly instance: string;
    readonly at: number;
    readonly auditHead?: number;
    readonly staged?: SiteReport['staged'];
    readonly bestBefore?: string;
  },
): Promise<SiteReport> {
  const effects = await application.pendingEffects(hostContext(options.workspaceId), {
    limit: 10_000,
    includeHeld: true,
  });
  const byTarget = new Map<string, { pending: number; held: number; acknowledged: number }>();
  for (const effect of effects) {
    const entry = byTarget.get(effect.target) ?? { pending: 0, held: 0, acknowledged: 0 };
    if (effect.heldAt !== undefined) entry.held++;
    else if (effect.acknowledgedAt !== undefined) entry.acknowledged++;
    else entry.pending++;
    byTarget.set(effect.target, entry);
  }
  const targets = [...byTarget]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 100)
    .map(([target, counts]) => ({ target, ...counts }));
  const total = (key: 'pending' | 'held' | 'acknowledged') =>
    targets.reduce((sum, target) => sum + target[key], 0);
  return {
    application: options.application,
    instance: options.instance,
    at: options.at,
    outbox: {
      pending: total('pending'),
      held: total('held'),
      acknowledged: total('acknowledged'),
      targets,
    },
    ...(options.auditHead !== undefined ? { auditHead: options.auditHead } : {}),
    ...(options.staged ? { staged: options.staged } : {}),
    ...(options.bestBefore ? { bestBefore: options.bestBefore } : {}),
  };
}
