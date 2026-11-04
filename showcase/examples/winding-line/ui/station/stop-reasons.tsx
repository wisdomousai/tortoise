import type { OutputOf } from '@tortoise/contracts';
import { OperatorPanel } from '@/components/operator-station';
import { TilePicker } from '@/components/tile-picker';
import { client } from '@/lib/session';
import { operations } from '../../contracts';
import { categoryWord, type Station } from './format';
import type { Run } from './use-station-commands';

type Reason = OutputOf<typeof operations.reasonList>['items'][number];

/** Classify the current stop; a reason the MES refused is shown and asked for again. */
export function StopReasons({
  stop,
  reasons,
  pending,
  run,
}: {
  stop: NonNullable<Station['currentStop']>;
  reasons: readonly Reason[];
  pending: string | undefined;
  run: Run;
}) {
  return (
    <OperatorPanel
      title="Why did it stop?"
      aside="Tap a reason or press its number. It goes to the MES."
    >
      {stop.sync === 'rejected' && stop.rejection && (
        <p className="font-semibold text-op-fault">
          The MES refused {stop.reason}: {stop.rejection.message}. Choose again.
        </p>
      )}
      <TilePicker
        label={`Why did the machine stop?${stop.alarm ? ` Alarm: ${stop.alarm}` : ''}`}
        tiles={reasons.map((reason) => ({
          value: reason.code,
          label: reason.text,
          detail: categoryWord[reason.category],
          tone: reason.category === 'quality' ? ('caution' as const) : undefined,
        }))}
        selected={stop.reason}
        pending={pending === 'classify'}
        onPick={(reason) =>
          void run('classify', () =>
            client.command(operations.stopClassify, { stopId: stop.id, reason }),
          )
        }
      />
    </OperatorPanel>
  );
}
