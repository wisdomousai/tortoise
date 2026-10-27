import { useQuery } from '@tanstack/react-query';
import { ApprovalReview } from '@/components/approval-review';
import { live } from '@/lib/session';
import { approvalOperations } from '../contracts';

const describe = (approval: { operation: string; input: Record<string, unknown> }) =>
  approval.operation === 'task.create'
    ? `Add task "${String(approval.input.title)}"`
    : approval.operation === 'task.set-status'
      ? `Mark task ${String(approval.input.id)} ${String(approval.input.status)}`
      : approval.operation;

/** Pending approval requests from the planner across the caller's work orders, each with Approve and Reject. */
export function ApprovalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
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

/** The number of pending approval requests beside the navigation label; nothing when there are none. */
export function PendingApprovalCount() {
  const open = useQuery(
    live.liveQueryOptions(approvalOperations.approvalList, { status: 'pending', limit: 1 }),
  );
  const total = open.data?.total ?? 0;
  return total ? <span className="text-xs text-muted-foreground">{total}</span> : null;
}
