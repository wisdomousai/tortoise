import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyCapability } from '@agent-native/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { client, live } from '@/lib/session';

type Query = AnyCapability & { kind: 'query' };
type Command = AnyCapability & { kind: 'command' };
interface OpenProposal {
  id: string;
  operation: string;
  input: Record<string, unknown>;
  rationale: string;
  confidence?: number;
  model?: string;
  resource?: string;
  proposedBy: string;
  expiresAt: number;
}

const refusal = (error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === 'FORBIDDEN') return 'You may not run this command.';
  if (code === 'CONFLICT') return 'The record changed or the proposal closed. Nothing was changed.';
  return error instanceof Error ? error.message : 'The command failed.';
};

function ProposalItem({
  proposal,
  accept,
  reject,
  describe,
}: {
  proposal: OpenProposal;
  accept: Command;
  reject: Command;
  describe?: (proposal: OpenProposal) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  // Each click is its own attempt; a retry after a refusal is a new decision.
  const act = async (command: Command) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await client.command(command, { id: proposal.id } as never);
    } catch (error) {
      setMessage(refusal(error));
    } finally {
      setBusy(false);
    }
  };
  const label = describe?.(proposal) ?? proposal.operation;
  return (
    <li aria-label={label} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        {proposal.resource && <Badge variant="outline">{proposal.resource}</Badge>}
        {proposal.confidence !== undefined && (
          <Badge variant="secondary">{Math.round(proposal.confidence * 100)}% confidence</Badge>
        )}
      </div>
      <p className="text-sm">{proposal.rationale}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {Object.entries(proposal.input).map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Proposed by {proposal.proposedBy}
        {proposal.model ? ` with ${proposal.model}` : ''}, open until{' '}
        {new Date(proposal.expiresAt).toLocaleString()}
      </p>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act(accept)}>
          Accept
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(reject)}>
          Reject
        </Button>
      </div>
    </li>
  );
}

/**
 * Open proposals, live, each with what it would run, why, and Accept and Reject. Accepting runs
 * the proposed command as the signed-in person, so the instance refuses a command they may not
 * run and conflicts when a record changed since the proposer read it; both leave the proposal
 * open and show here. Pass `resource` to show only the proposals about one record.
 */
export function ProposalReview({
  title = 'Proposals',
  list,
  accept,
  reject,
  resource,
  describe,
}: {
  title?: string;
  list: Query;
  accept: Command;
  reject: Command;
  resource?: string;
  /** A short label for a proposal, for example "Classify stop 42 as tooling"; the operation ID when omitted. */
  describe?: (proposal: OpenProposal) => string;
}) {
  const input = { status: 'open', limit: 50, ...(resource ? { resource } : {}) };
  const query = useQuery(live.liveQueryOptions(list, input as never));
  const items = (query.data as { items: OpenProposal[] } | undefined)?.items ?? [];
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-base font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open proposals.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((proposal) => (
            <ProposalItem
              key={proposal.id}
              proposal={proposal}
              accept={accept}
              reject={reject}
              {...(describe ? { describe } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
