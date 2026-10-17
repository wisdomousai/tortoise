import type { Proposal } from '@agent-native/contracts';
import { defineTrigger } from '@agent-native/automation/contracts';
import type { Job } from '@agent-native/automation/jobs';
import { createAutomationPlugin } from '@agent-native/automation/plugin';

/**
 * Closes stop-reason proposals nobody accepted in time, so the station's attention queue does
 * not fill with stale ones. It runs as the supervisor who enabled it and closes only the
 * proposals at their stations.
 */
export const expireProposals = defineTrigger({
  id: 'expire-proposals',
  title: 'Close expired proposals',
  on: { schedule: { everyMs: 5 * 60_000 } },
  run: { job: 'expire-proposals', operations: ['proposal.list', 'proposal.expire'] },
  budgets: { toolCalls: 200, wallTimeMs: 60_000 },
});

/** Expire every open proposal at the issuer's stations whose expiry has passed. */
export const expireJob =
  (now = Date.now): Job =>
  async ({ query, command }) => {
    const open = await query<{ items: Proposal[] }>('proposal.list', {
      status: 'open',
      limit: 100,
    });
    const at = now();
    for (const proposal of open.data.items)
      if (proposal.expiresAt <= at) await command('proposal.expire', { id: proposal.id });
  };

export const lineAutomationPlugin = createAutomationPlugin({
  triggers: [expireProposals],
  jobs: { 'expire-proposals': expireJob() },
});
