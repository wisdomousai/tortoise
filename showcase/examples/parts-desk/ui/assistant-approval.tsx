import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { approvalOperations, type ApprovalRequest } from '@tortoise/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';
import { titleOf, useCatalogOperation } from './assistant-calls';
import { useScreenCommand } from './command';
import { toneClass } from './format';

const statusTone = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  expired: 'muted',
} as const;

/** The requested command's input in words, such as "15 percent off Q-00003". */
function useInputInWords(approval: ApprovalRequest): { words: string; reason?: string } {
  const input = approval.input;
  const quoteId = typeof input.id === 'string' ? input.id : undefined;
  const quote = useQuery({
    ...live.liveQueryOptions(operations.quoteGet, { id: quoteId ?? '' }),
    enabled: quoteId !== undefined && approval.operation.startsWith('quote.'),
  }).data;
  const number = quote?.number ?? 'the quote';
  const reason = typeof input.reason === 'string' ? input.reason : undefined;
  if (approval.operation === 'quote.discount')
    return { words: `${String(input.percent)} percent off ${number}`, reason };
  if (approval.operation === 'quote.cancel') return { words: `Cancel ${number}`, reason };
  return {
    words: Object.entries(input)
      .map(
        ([name, value]) => `${name} ${typeof value === 'string' ? value : JSON.stringify(value)}`,
      )
      .join(', '),
  };
}

/**
 * The approval request an `approval.request` call recorded: the requested command's title, its
 * input in words, the rationale and the request's state, read live from `approval.get`. A
 * supervisor sees Approve and Reject; everyone else sees that a supervisor must decide. Approving
 * runs the command as the approver, so the command's own rule still decides.
 */
export function ApprovalCard({ id }: { id: string }) {
  const approval = useQuery(live.liveQueryOptions(approvalOperations.approvalGet, { id })).data;
  if (!approval)
    return (
      <section aria-label="Approval request" className="rounded-lg border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Approval request</span>
      </section>
    );
  return <ApprovalDetails approval={approval} />;
}

function ApprovalDetails({ approval }: { approval: ApprovalRequest }) {
  const requested = useCatalogOperation(approval.operation);
  const { words, reason } = useInputInWords(approval);
  const role = useQuery(live.liveQueryOptions(operations.memberCurrent, {})).data?.role;
  const approve = useScreenCommand(approvalOperations.approvalApprove);
  const reject = useScreenCommand(approvalOperations.approvalReject);
  const pending = approve.pending || reject.pending;
  const error = approve.error ?? reject.error;
  return (
    <section
      aria-label="Approval request"
      className="space-y-1.5 rounded-lg border bg-card px-3 py-2 text-[0.8rem]"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        <span>Approval request</span>
        <Badge variant="outline" className={cn('ml-auto', toneClass[statusTone[approval.status]])}>
          {approval.status}
        </Badge>
      </div>
      <p>
        <span className="font-medium">{titleOf(requested, approval.operation)}</span>
        <span className="text-muted-foreground"> · </span>
        <span>{words}</span>
      </p>
      {reason && <p className="text-xs text-muted-foreground">Reason: {reason}</p>}
      <p className="border-l-2 pl-2 text-xs whitespace-pre-wrap text-muted-foreground">
        {approval.rationale}
      </p>
      {approval.status === 'pending' ? (
        role === 'supervisor' ? (
          <div className="flex gap-1.5 pt-0.5">
            <Button
              size="xs"
              disabled={pending}
              onClick={() => void approve.run({ id: approval.id })}
            >
              Approve
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => void reject.run({ id: approval.id })}
            >
              Reject
            </Button>
          </div>
        ) : (
          <p className="text-xs text-warning">A supervisor must decide.</p>
        )
      ) : approval.closedBy ? (
        <p className="text-xs text-muted-foreground">
          {approval.status} by {approval.closedBy}
          {approval.reason ? `: ${approval.reason}` : ''}
        </p>
      ) : null}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
