import * as React from 'react';
import { AttentionQueue, type AttentionItem } from '@/components/attention-queue';
import { OperatorSurface, type OperatorDensity } from '@/components/operator-surface';
import { StatusStrip } from '@/components/status-strip';
import { TakeoverButton } from '@/components/takeover-button';
import { cn } from '@/lib/utils';

/**
 * Layout skeleton of a full-window station screen. The fixed order matters more than the parts:
 * a dark bar with where and who, seat control and station actions; then the machine state, large
 * enough to read from the machine; then the one task at hand beside anything that needs a
 * person; then a footer for history. Every slot is data from queries and every action is a
 * callback that issues a catalog command; the block holds no state of its own beyond what its
 * parts need for input.
 */
function OperatorStation({
  title,
  context,
  back,
  headerActions,
  banner,
  status,
  attention,
  onResolveAttention,
  attentionPendingId,
  seat,
  footer,
  children,
  density = 'glove',
  contrast,
  className,
}: {
  title: React.ReactNode;
  context?: React.ReactNode;
  /** Leading header control, usually a link back to the station list. */
  back?: React.ReactNode;
  headerActions?: React.ReactNode;
  /** The machine state and what it is working on, shown large under the header. */
  banner?: React.ReactNode;
  /** Secondary status pills, for example bridge mode or upstream delivery. */
  status?: React.ReactNode;
  attention?: readonly AttentionItem[];
  onResolveAttention?: (id: string, value: string) => void;
  attentionPendingId?: string;
  /** Omit for stations without a background agent. Shown in the header, always within reach. */
  seat?: React.ComponentProps<typeof TakeoverButton>;
  /** History and secondary facts under the task, for example the last stops. */
  footer?: React.ReactNode;
  /** The current task: scan prompt, tile picker, numeric pad, counters. */
  children: React.ReactNode;
  density?: OperatorDensity;
  contrast?: 'normal' | 'high';
  className?: string;
}) {
  const hasAttention = attention && attention.length > 0 && onResolveAttention;
  return (
    <OperatorSurface
      density={density}
      contrast={contrast}
      className={cn('gap-0 bg-muted p-0', className)}
    >
      <header
        data-slot="operator-header"
        className="flex flex-wrap items-center gap-(--operator-gap) bg-foreground px-(--operator-gap) py-3 text-background"
      >
        {back}
        <div className="min-w-0 flex-[1_1_14rem]">
          <h1 className="truncate text-(length:--operator-text-lg) leading-tight font-bold">
            {title}
          </h1>
          {context && <div className="text-(length:--operator-text) opacity-75">{context}</div>}
        </div>
        {seat && <TakeoverButton className="w-auto sm:min-w-72" {...seat} />}
        {headerActions && (
          <div className="flex items-center gap-(--operator-gap)">{headerActions}</div>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-(--operator-gap) p-(--operator-gap)">
        {banner}
        {status && <StatusStrip>{status}</StatusStrip>}
        <div
          className={cn(
            'grid flex-1 items-start gap-(--operator-gap)',
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
        {footer && (
          <footer className="rounded-2xl bg-card px-4 py-3 text-(length:--operator-text)">
            {footer}
          </footer>
        )}
      </div>
    </OperatorSurface>
  );
}

/** A white panel on the station surface, for the task, the counters or the order. */
function OperatorPanel({
  title,
  aside,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode;
  /** A short instruction beside the title. */
  aside?: React.ReactNode;
}) {
  return (
    <section
      data-slot="operator-panel"
      className={cn(
        'space-y-(--operator-gap) rounded-2xl bg-card p-6 text-card-foreground',
        className,
      )}
      {...props}
    >
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && (
            <h2 className="text-(length:--operator-text-lg) leading-tight font-bold">{title}</h2>
          )}
          {aside && <span className="text-muted-foreground">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export { OperatorStation, OperatorPanel };
