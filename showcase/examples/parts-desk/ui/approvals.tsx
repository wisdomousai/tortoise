import { approvalOperations } from '@agent-native/contracts';
import { ApprovalReview } from '@/components/approval-review';

/** Pending approval requests from every agent, each with Approve and Reject. */
export function ApprovalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <ApprovalReview
        title="Pending approvals"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        describe={(approval) => `${approval.resource ?? ''}: ${approval.operation}`}
      />
    </div>
  );
}
