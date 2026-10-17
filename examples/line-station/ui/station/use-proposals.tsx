import { useQuery } from '@tanstack/react-query';
import { proposalChoices, type AttentionItem } from '@/components/attention-queue';
import { client, live } from '@/lib/session';
import { operations } from '../../contracts';
import type { Run } from './use-station-commands';

const PREFIX = 'proposal:';

/**
 * Open proposals to classify the current stop, as attention items with Accept and Reject.
 * Accepting classifies the stop as the operator, so a viewer or a changed stop is refused by the
 * authority and the proposal stays open. Item IDs carry a `proposal:` prefix so they never
 * collide with attention entries.
 */
export function useProposals(stopId: string | undefined, run: Run) {
  const proposals = useQuery({
    ...live.liveQueryOptions(operations.proposalList, {
      status: 'open',
      operation: operations.stopClassify.id,
      resource: `stop:${stopId ?? ''}`,
    }),
    enabled: stopId !== undefined,
  });
  const reasons = useQuery(live.liveQueryOptions(operations.reasonList, {}));
  const reasonText = (code: unknown) =>
    reasons.data?.items.find((reason) => reason.code === code)?.text ?? String(code);
  const items: AttentionItem[] = (stopId ? (proposals.data?.items ?? []) : []).map((proposal) => ({
    id: `${PREFIX}${proposal.id}`,
    kind: 'proposal',
    title: `Classify the stop as ${reasonText(proposal.input.reason)}`,
    detail: proposal.rationale,
    proposed: String(proposal.input.reason),
    ...(proposal.confidence === undefined ? {} : { confidence: proposal.confidence }),
    source: proposal.model ?? 'Agent',
    choices: proposalChoices(),
  }));
  /** Handle a proposal item's choice; false when the item is not a proposal. */
  const resolve = (itemId: string, value: string) => {
    if (!itemId.startsWith(PREFIX)) return false;
    const id = itemId.slice(PREFIX.length);
    void run(`attention:${itemId}`, () =>
      value === 'accept'
        ? client.command(operations.proposalAccept, { id })
        : client.command(operations.proposalReject, { id }),
    );
    return true;
  };
  return { items, resolve };
}
