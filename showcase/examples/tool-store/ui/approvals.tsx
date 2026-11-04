import { useQuery } from '@tanstack/react-query';
import { approvalOperations } from '@tortoise/contracts';
import { ApprovalReview } from '@/components/approval-review';
import { live } from '@/lib/session';
import { operations } from '../contracts';

/**
 * Pending approval requests, each with Approve and Reject. The repair triage agent requests
 * `tool.retire` for tools in repair; approving retires the tool as the signed-in person, so a
 * viewer is refused and the request stays pending.
 */
export function ApprovalsScreen() {
  // The agent asks only about tools in repair, so their tags name the requests.
  const inRepair = useQuery(
    live.liveQueryOptions(operations.toolList, { status: 'in-repair', limit: 100 }),
  );
  const tags = new Map(inRepair.data?.items.map((tool) => [tool.id, tool.assetTag]));
  const describe = (approval: { operation: string; input: Record<string, unknown> }) => {
    if (approval.operation !== operations.toolRetire.id) return approval.operation;
    const toolId = String(approval.input.toolId);
    return `Retire ${tags.get(toolId) ?? toolId}`;
  };
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <p className="text-sm text-muted-foreground">
        Approve to retire the tool as yourself. Reject to keep it in repair.
      </p>
      <ApprovalReview
        title="Pending approvals"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        describe={describe}
      />
    </div>
  );
}
