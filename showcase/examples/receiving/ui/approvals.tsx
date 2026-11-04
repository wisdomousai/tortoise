import { ApprovalReview } from '@/components/approval-review';
import { approvalOperations } from '@tortoise/contracts';
import { reasonOf } from './delivery';

/** Pending approval requests across every delivery line, each with Approve and Reject. */
export function ApprovalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <ApprovalReview
        title="Pending approvals"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        describe={(approval) =>
          `${approval.resource?.slice('delivery:'.length) ?? ''}: ${reasonOf(approval)}`
        }
      />
    </div>
  );
}
