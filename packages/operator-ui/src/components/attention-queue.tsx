import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BigAction } from '@/components/big-action';
import { cn } from '@/lib/utils';

export interface AttentionChoice {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly tone?: 'primary' | 'positive' | 'negative' | 'caution' | 'neutral';
  /** Require press-and-hold, for choices that release held effects or change machine state. */
  readonly hold?: boolean;
}

export interface AttentionItem {
  readonly id: string;
  /**
   * `reading`: a value read below its confidence threshold. `question`: an agent asks the
   * operator. `reconcile`: the outcome of a screen action could not be confirmed.
   */
  readonly kind: 'reading' | 'question' | 'reconcile';
  readonly title: React.ReactNode;
  readonly detail?: React.ReactNode;
  /** The value the system believes, shown large so the operator can compare with the machine. */
  readonly proposed?: React.ReactNode;
  readonly confidence?: number;
  /** Where the proposal came from (extractor, model, agent), for the operator's judgment. */
  readonly source?: React.ReactNode;
  readonly choices: readonly AttentionChoice[];
}

const kindLabel: Record<AttentionItem['kind'], string> = {
  reading: 'Check reading',
  question: 'Question',
  reconcile: 'Confirm outcome',
};

/**
 * Items that need a person: uncertain readings, agent questions and unconfirmed screen actions.
 * Nothing in the queue is promoted to fact until the operator picks a choice; the caller turns
 * the choice into a catalog command and keeps the item pending until the command commits.
 * The oldest item is shown first and expanded; the rest are counted.
 */
function AttentionQueue({
  items,
  onResolve,
  pendingId,
  empty = 'Nothing needs your attention',
  className,
}: {
  items: readonly AttentionItem[];
  onResolve: (id: string, value: string) => void;
  /** Item whose resolution is in flight; its choices are disabled. */
  pendingId?: string;
  empty?: React.ReactNode;
  className?: string;
}) {
  const [current, ...rest] = items;
  if (!current)
    return (
      <p
        data-slot="attention-queue"
        className={cn('text-(length:--operator-text) text-muted-foreground', className)}
      >
        {empty}
      </p>
    );
  const pending = pendingId === current.id;
  return (
    <section
      data-slot="attention-queue"
      aria-label="Needs attention"
      className={cn('space-y-(--operator-gap)', className)}
    >
      <Card className="border-2 border-op-attention">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="h-auto bg-op-attention px-2.5 py-1 text-[0.8em] text-op-attention-foreground">
              {kindLabel[current.kind]}
            </Badge>
            {rest.length > 0 && (
              <Badge variant="outline" className="h-auto px-2.5 py-1 text-[0.8em]">
                {rest.length} more waiting
              </Badge>
            )}
          </div>
          <CardTitle className="text-(length:--operator-text-lg)">{current.title}</CardTitle>
          {current.detail && (
            <CardDescription className="text-(length:--operator-text)">
              {current.detail}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-(--operator-gap)">
          {current.proposed !== undefined && (
            <div className="rounded-lg bg-muted px-4 py-3">
              <p className="font-mono text-(length:--operator-text-xl) font-semibold tabular-nums">
                {current.proposed}
              </p>
              {(current.source || current.confidence !== undefined) && (
                <p className="text-(length:--operator-text) text-muted-foreground">
                  {current.source}
                  {current.source && current.confidence !== undefined && ' · '}
                  {current.confidence !== undefined &&
                    `${Math.round(current.confidence * 100)} % sure`}
                </p>
              )}
            </div>
          )}
          <div
            className={cn(
              'grid gap-(--operator-gap)',
              current.choices.length > 1 && 'sm:grid-cols-2',
              current.choices.length > 2 && 'lg:grid-cols-3',
            )}
          >
            {current.choices.map((choice) => (
              <BigAction
                key={choice.value}
                label={choice.label}
                tone={choice.tone ?? 'neutral'}
                hold={choice.hold}
                pending={pending}
                onAction={() => onResolve(current.id, choice.value)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export { AttentionQueue };
