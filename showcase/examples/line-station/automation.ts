import type { ApprovalRequest } from '@agent-native/contracts';
import { defineTrigger } from '@agent-native/automation/contracts';
import type { Job } from '@agent-native/automation/jobs';
import { createAutomationPlugin } from '@agent-native/automation/plugin';

/**
 * Closes stop-reason approval requests nobody approved in time, so the station's attention queue does
 * not fill with stale ones. It runs as the supervisor who enabled it and closes only the
 * approval requests at their stations.
 */
export const expireApprovals = defineTrigger({
  id: 'expire-approval-requests',
  title: 'Close expired approvals',
  on: { schedule: { everyMs: 5 * 60_000 } },
  run: { job: 'expire-approval-requests', operations: ['approval.list', 'approval.expire'] },
  budgets: { toolCalls: 200, wallTimeMs: 60_000 },
});

/** Expire every pending approval request at the issuer's stations whose expiry has passed. */
export const expireJob =
  (now = Date.now): Job =>
  async ({ query, command }) => {
    const open = await query<{ items: ApprovalRequest[] }>('approval.list', {
      status: 'pending',
      limit: 100,
    });
    const at = now();
    for (const approval of open.data.items)
      if (approval.expiresAt <= at) await command('approval.expire', { id: approval.id });
  };

export const lineAutomationPlugin = createAutomationPlugin({
  triggers: [expireApprovals],
  jobs: { 'expire-approval-requests': expireJob() },
});
