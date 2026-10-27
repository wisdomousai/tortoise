import { OctagonX, Play } from 'lucide-react';
import { AttentionQueue } from '@/components/attention-queue';
import { BigAction } from '@/components/big-action';
import { NumericPad } from '@/components/numeric-pad';
import { ScanPrompt } from '@/components/scan-prompt';
import { TakeoverButton } from '@/components/takeover-button';
import { TilePicker } from '@/components/tile-picker';
import type { useFeedback } from '@/hooks/use-feedback';
import { stopReasons, type StationDemo } from './demo';

/** Scan, pick, hold, keypad, attention and takeover side by side, on local state only. */
export function StationTab({
  demo,
  feedback,
}: {
  demo: StationDemo;
  feedback: ReturnType<typeof useFeedback>;
}) {
  return (
    <>
      <div className="space-y-(--operator-gap)">
        <ScanPrompt
          prompt="Scan the order"
          hint="Order labels start with ORD-; GS1 material labels also work."
          last={demo.scan}
          onManual={(value) =>
            demo.setScan({ value, ok: /^ORD-\d{4,}$/.test(value), message: 'Typed' })
          }
        />
        <TilePicker
          label="Stop reason"
          tiles={stopReasons}
          selected={demo.reason}
          onPick={(value) => {
            demo.setReason(value);
            feedback.play('accepted');
          }}
        />
        <BigAction
          tone={demo.running ? 'negative' : 'positive'}
          hold
          icon={demo.running ? <OctagonX aria-hidden /> : <Play aria-hidden />}
          label={demo.running ? 'Request stop' : 'Request start'}
          onAction={() => demo.setRunning(!demo.running)}
        />
      </div>
      <div className="space-y-(--operator-gap)">
        <NumericPad
          label="Measured length"
          value={demo.measured}
          onChange={demo.setMeasured}
          onSubmit={(value) => {
            demo.setRecorded(value);
            demo.setMeasured('');
          }}
          unit="mm"
          decimals={2}
          separator=","
          tolerance={{ lower: 119.8, upper: 120.2, target: 120 }}
          // Digit keys belong to the tile picker on this screen; the pad is tapped.
          keyboard={false}
        />
        {demo.recorded !== undefined && (
          <p role="status" className="text-(length:--operator-text)">
            Recorded {demo.recorded} mm
          </p>
        )}
        <AttentionQueue
          items={demo.attention}
          onResolve={(id) => demo.setAttention((items) => items.filter((item) => item.id !== id))}
        />
        <TakeoverButton
          holder={demo.holder}
          activity="Loading recipe R-250 · step 3 of 7"
          onTakeOver={() => demo.setHolder('operator')}
          onHandBack={() => demo.setHolder('agent')}
        />
      </div>
    </>
  );
}
