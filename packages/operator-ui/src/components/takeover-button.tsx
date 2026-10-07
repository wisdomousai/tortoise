import * as React from 'react';
import { Bot, Hand } from 'lucide-react';
import { BigAction } from '@/components/big-action';
import { cn } from '@/lib/utils';

export type SeatOwner = 'operator' | 'agent' | 'idle';

/**
 * Seat control for a station screen shared by an operator and a background agent. Taking over is
 * a single tap and is never guarded: the operator always preempts the agent. Handing the screen
 * back needs a hold, because the agent may act on the machine afterwards. The button only issues
 * the request; the seat shown is the one the bridge reports, so a pending takeover is visible.
 */
function TakeoverButton({
  seat,
  requested,
  activity,
  onTakeOver,
  onHandBack,
  pending = false,
  className,
}: {
  /** Seat as reported by the bridge. */
  seat: SeatOwner;
  /** Seat the operator asked for, while the bridge has not confirmed it. */
  requested?: SeatOwner;
  /** What the agent is doing, e.g. "Loading recipe R-12 · step 3 of 7". */
  activity?: React.ReactNode;
  onTakeOver: () => void;
  onHandBack: () => void;
  pending?: boolean;
  className?: string;
}) {
  const waiting = requested !== undefined && requested !== seat;
  if (seat === 'operator' || requested === 'operator')
    return (
      <BigAction
        className={cn(className)}
        tone="neutral"
        size="compact"
        hold
        pending={pending || waiting}
        icon={<Bot aria-hidden />}
        label={
          !waiting
            ? 'Hand back to agent'
            : requested === 'operator'
              ? 'Taking over…'
              : 'Handing back…'
        }
        description={
          !waiting
            ? 'Press and hold'
            : requested === 'operator'
              ? 'Waiting for the agent to stop'
              : 'Waiting for the bridge'
        }
        onAction={onHandBack}
      />
    );
  return (
    <BigAction
      className={cn(className)}
      tone={seat === 'agent' ? 'caution' : 'neutral'}
      size="compact"
      pending={pending}
      icon={<Hand aria-hidden />}
      label="Take over"
      description={
        seat === 'agent' ? (activity ?? 'Agent is using the station') : 'Station is idle'
      }
      onAction={onTakeOver}
    />
  );
}

export { TakeoverButton };
