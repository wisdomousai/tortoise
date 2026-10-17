import { useQuery } from '@tanstack/react-query';
import { ProposalReview } from '@/components/proposal-review';
import { live } from '@/lib/session';
import { proposalOperations } from '../contracts';

const describe = (proposal: { operation: string; input: Record<string, unknown> }) =>
  proposal.operation === 'task.create'
    ? `Add task "${String(proposal.input.title)}"`
    : proposal.operation === 'task.set-status'
      ? `Mark task ${String(proposal.input.id)} ${String(proposal.input.status)}`
      : proposal.operation;

/** Open proposals from the planner across the caller's projects, each with Accept and Reject. */
export function ProposalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      <ProposalReview
        title="Open proposals"
        list={proposalOperations.proposalList}
        accept={proposalOperations.proposalAccept}
        reject={proposalOperations.proposalReject}
        describe={describe}
      />
    </div>
  );
}

/** The number of open proposals beside the navigation label; nothing when there are none. */
export function OpenProposalCount() {
  const open = useQuery(
    live.liveQueryOptions(proposalOperations.proposalList, { status: 'open', limit: 1 }),
  );
  const total = open.data?.total ?? 0;
  return total ? <span className="text-xs text-muted-foreground">{total}</span> : null;
}
