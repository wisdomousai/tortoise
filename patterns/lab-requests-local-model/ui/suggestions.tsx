import { approvalOperations } from '@agent-native/contracts';
import { ApprovalReview } from '@/components/approval-review';

const describe = (approval: { input: unknown }) =>
  `Test method: ${String((approval.input as { method?: unknown }).method ?? '')}`;

/** Added below the base pattern's test request screen: the methods the local model suggested. */
export function MethodSuggestions({ id }: { id: string }) {
  return (
    <section aria-label="Method suggestions">
      <ApprovalReview
        title="Suggested test methods"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        resource={`test-request:${id}`}
        describe={describe}
      />
    </section>
  );
}

/** Every pending approval request. */
export function Approvals() {
  return (
    <ApprovalReview
      title="Approval requests"
      list={approvalOperations.approvalList}
      approve={approvalOperations.approvalApprove}
      reject={approvalOperations.approvalReject}
      describe={describe}
    />
  );
}
