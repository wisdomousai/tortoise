import * as React from 'react';
import { AttentionQueue, type AttentionItem } from '@/components/attention-queue';
import {
  OperatorHeader,
  OperatorSurface,
  type OperatorDensity,
} from '@/components/operator-surface';
import { StatusStrip } from '@/components/status-strip';
import { TakeoverButton, type SeatOwner } from '@/components/takeover-button';
import { cn } from '@/lib/utils';

/**
 * Layout skeleton of a station screen. The fixed order matters more than the parts: who and
 * where at the top, then the station signals, then the one task at hand, then anything that
 * needs a person, then seat control where a background agent shares the screen. Every slot is
 * data from queries and every action is a callback that issues a catalog command; the block holds
 * no state of its own beyond what its parts need for input.
 */
function OperatorStation({
  title,
  context,
  headerActions,
  status,
  attention,
  onResolveAttention,
  attentionPendingId,
  seat,
  children,
  density = 'glove',
  contrast,
  className,
}: {
  title: React.ReactNode;
  context?: React.ReactNode;
  headerActions?: React.ReactNode;
  /** Status pills, usually machine state, bridge mode, seat and upstream delivery. */
  status?: React.ReactNode;
  attention?: readonly AttentionItem[];
  onResolveAttention?: (id: string, value: string) => void;
  attentionPendingId?: string;
  /** Omit for stations without a background agent. */
  seat?: React.ComponentProps<typeof TakeoverButton>;
  /** The current task: scan prompt, tile picker, numeric pad. */
  children: React.ReactNode;
  density?: OperatorDensity;
  contrast?: 'normal' | 'high';
  className?: string;
}) {
  const hasAttention = attention && attention.length > 0 && onResolveAttention;
  return (
    <OperatorSurface density={density} contrast={contrast} className={className}>
      <OperatorHeader title={title} context={context} actions={headerActions} />
      {status && <StatusStrip>{status}</StatusStrip>}
      <div
        className={cn(
          'grid flex-1 gap-(--operator-gap)',
          hasAttention && 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
        )}
      >
        <main className="min-w-0 space-y-(--operator-gap)">{children}</main>
        {hasAttention && (
          <AttentionQueue
            items={attention}
            onResolve={onResolveAttention}
            pendingId={attentionPendingId}
          />
        )}
      </div>
      {seat && (
        <footer className="flex justify-end">
          <TakeoverButton className="sm:w-auto sm:min-w-80" {...seat} />
        </footer>
      )}
    </OperatorSurface>
  );
}

export { OperatorStation };
