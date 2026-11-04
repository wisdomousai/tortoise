import { useQuery } from '@tanstack/react-query';
import { approvalOperations } from '@tortoise/contracts';
import { approvalChoices, type AttentionItem } from '@/components/attention-queue';
import { client, live } from '@/lib/session';
import { operations } from '../../contracts';
import type { Run } from './use-station-commands';

const PREFIX = 'approval-request:';

/**
 * Pending approval requests to classify the current stop, as attention items with Approve and Reject.
 * Approving classifies the stop as the operator, so a viewer or a changed stop is refused by the
 * instance and the approval request stays open. Item IDs carry a `approval-request:` prefix so they never
 * collide with attention entries.
 */
export function useApprovalRequests(stopId: string | undefined, run: Run) {
  const approvals = useQuery({
    ...live.liveQueryOptions(approvalOperations.approvalList, {
      status: 'pending',
      operation: operations.stopClassify.id,
      resource: `stop:${stopId ?? ''}`,
    }),
    enabled: stopId !== undefined,
  });
  const reasons = useQuery(live.liveQueryOptions(operations.reasonList, {}));
  const reasonText = (code: unknown) =>
    reasons.data?.items.find((reason) => reason.code === code)?.text ?? String(code);
  const items: AttentionItem[] = (stopId ? (approvals.data?.items ?? []) : []).map((approval) => ({
    id: `${PREFIX}${approval.id}`,
    kind: 'approval',
    title: `Classify the stop as ${reasonText(approval.input.reason)}`,
    detail: approval.rationale,
    proposed: String(approval.input.reason),
    ...(approval.confidence === undefined ? {} : { confidence: approval.confidence }),
    source: approval.model ?? 'Agent',
    choices: approvalChoices(),
  }));
  /** Handle an approval request item's choice; false when the item is not an approval request. */
  const resolve = (itemId: string, value: string) => {
    if (!itemId.startsWith(PREFIX)) return false;
    const id = itemId.slice(PREFIX.length);
    void run(`attention:${itemId}`, () =>
      value === 'approve'
        ? client.command(approvalOperations.approvalApprove, { id })
        : client.command(approvalOperations.approvalReject, { id }),
    );
    return true;
  };
  return { items, resolve };
}
