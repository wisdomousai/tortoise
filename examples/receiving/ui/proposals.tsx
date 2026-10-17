import { ProposalReview } from '@/components/proposal-review';
import { operations } from '../contracts';
import { reasonOf } from './delivery';

/** Open proposals across every delivery line, each with Accept and Reject. */
export function ProposalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      <ProposalReview
        title="Open proposals"
        list={operations.proposalList}
        accept={operations.proposalAccept}
        reject={operations.proposalReject}
        describe={(proposal) =>
          `${proposal.resource?.slice('delivery:'.length) ?? ''}: ${reasonOf(proposal)}`
        }
      />
    </div>
  );
}
