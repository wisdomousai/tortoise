import { useMemo, useState } from 'react';
import { OctagonX, Play, Volume2, VolumeX } from 'lucide-react';
import { defaultWedgeProfile, type ScanRoute, type ScannerProfile } from '@agent-native/devices';
import { AttentionQueue, type AttentionItem } from '@/components/attention-queue';
import { BigAction } from '@/components/big-action';
import { NumericPad } from '@/components/numeric-pad';
import {
  OperatorHeader,
  OperatorSurface,
  type OperatorDensity,
} from '@/components/operator-surface';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import { ScannerSetup } from '@/components/scanner-setup';
import { DeliveryBadge, Freshness, StatusPill, StatusStrip } from '@/components/status-strip';
import { TakeoverButton, type SeatOwner } from '@/components/takeover-button';
import { TilePicker } from '@/components/tile-picker';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFeedback } from '@/hooks/use-feedback';
import { useScanner } from '@/hooks/use-scanner';

const stopReasons = [
  'Material missing',
  'Tool change',
  'Jam',
  'Quality check',
  'Setup',
  'Cleaning',
  'Operator break',
  'Maintenance',
  'Waiting for crane',
  'Upstream blocked',
  'Downstream full',
  'Unknown',
].map((label, index) => ({
  value: `S${String(index + 1).padStart(2, '0')}`,
  label,
  detail: `S${String(index + 1).padStart(2, '0')}`,
  tone: label === 'Jam' ? ('negative' as const) : undefined,
}));

const routes: readonly ScanRoute[] = [
  { intent: 'order', pattern: '^ORD-(\\d{4,})$' },
  { intent: 'material', gs1Ai: '01' },
];

/**
 * Gallery of the operator registry at every density, wired to local state only. It is the
 * interaction target for browser tests (hold-to-confirm, tap guard, digit hotkeys, keypad) and
 * the place to judge the primitives on a real panel with gloves on. No capability is bound here.
 */
export function StationKitScreen() {
  const [density, setDensity] = useState<OperatorDensity>('glove');
  const [contrast, setContrast] = useState<'normal' | 'high'>('normal');
  const [reason, setReason] = useState<string>();
  const [measured, setMeasured] = useState('');
  const [recorded, setRecorded] = useState<number>();
  const [seat, setSeat] = useState<SeatOwner>('agent');
  const [running, setRunning] = useState(true);
  const [scan, setScan] = useState<ScanOutcome>();
  const [profile, setProfile] = useState<ScannerProfile>(() => defaultWedgeProfile('kit-wedge'));
  const [saved, setSaved] = useState<{ ok: boolean; message?: string }>();
  const [tab, setTab] = useState('station');
  const [attention, setAttention] = useState<readonly AttentionItem[]>([
    {
      id: 'reading-1',
      kind: 'reading',
      title: 'Good count read from the screen',
      detail: 'Compare with the counter on the machine.',
      proposed: '1 284',
      confidence: 0.71,
      source: 'Local OCR',
      choices: [
        { value: 'confirm', label: 'Matches', tone: 'positive' },
        { value: 'reject', label: 'Does not match', tone: 'negative' },
      ],
    },
    {
      id: 'reconcile-1',
      kind: 'reconcile',
      title: 'Was recipe R-12 loaded?',
      detail: 'The agent was interrupted before it could confirm the load.',
      choices: [
        { value: 'applied', label: 'Yes, loaded', tone: 'positive', hold: true },
        { value: 'not-applied', label: 'No', tone: 'neutral' },
      ],
    },
  ]);
  const feedback = useFeedback();
  const started = useMemo(() => Date.now(), []);
  useScanner({
    profile,
    routes,
    enabled: tab === 'station',
    onScan: (event) => {
      feedback.play('scan');
      setScan({ value: event.data, ok: false, message: 'Not an order or material label' });
    },
    onRoute: (routed) => {
      feedback.play('accepted');
      setScan({ value: routed.value, ok: true, message: `Recognized as ${routed.intent}` });
    },
  });

  return (
    <OperatorSurface density={density} contrast={contrast} className="min-h-0 rounded-2xl border">
      <OperatorHeader
        title="Operator kit"
        context="Line 3 · Station 2 · gallery, no data is written"
        actions={
          <>
            {(['glove', 'touch', 'desk'] as const).map((option) => (
              <Button
                key={option}
                variant={density === option ? 'default' : 'outline'}
                className="h-(--operator-target) text-(length:--operator-text)"
                aria-pressed={density === option}
                onClick={() => setDensity(option)}
              >
                {option}
              </Button>
            ))}
            <Button
              variant="outline"
              className="h-(--operator-target) text-(length:--operator-text)"
              aria-pressed={contrast === 'high'}
              onClick={() => setContrast(contrast === 'high' ? 'normal' : 'high')}
            >
              High contrast
            </Button>
            <Button
              variant="outline"
              className="h-(--operator-target) min-w-(--operator-target)"
              aria-label={feedback.muted ? 'Unmute feedback' : 'Mute feedback'}
              onClick={() => feedback.setMuted(!feedback.muted)}
            >
              {feedback.muted ? <VolumeX className="size-7" /> : <Volume2 className="size-7" />}
            </Button>
          </>
        }
      />
      <StatusStrip>
        <StatusPill
          signal={running ? 'ok' : 'fault'}
          label={running ? 'Running' : 'Stopped'}
          detail={<Freshness observedAt={started} />}
        />
        <StatusPill signal="pending" label="Monitor only" detail="Bridge mode" />
        <StatusPill
          signal={seat === 'agent' ? 'attention' : 'idle'}
          label={
            seat === 'agent'
              ? 'Agent at screen'
              : seat === 'operator'
                ? 'You have the screen'
                : 'Screen idle'
          }
        />
        <div className="flex items-center gap-2">
          <DeliveryBadge state="accepted" reference="MES-104233" />
          <DeliveryBadge state="held" />
          <DeliveryBadge
            state="rejected"
            reason={{ code: 'ORDER_CLOSED', message: 'Order is closed' }}
          />
        </div>
      </StatusStrip>
      <Tabs value={tab} onValueChange={setTab} className="flex-col">
        <TabsList className="h-(--operator-target)">
          <TabsTrigger value="station" className="px-6 text-(length:--operator-text)">
            Station
          </TabsTrigger>
          <TabsTrigger value="scanner" className="px-6 text-(length:--operator-text)">
            Scanner setup
          </TabsTrigger>
        </TabsList>
        <TabsContent value="station" className="grid gap-(--operator-gap) xl:grid-cols-2">
          <div className="space-y-(--operator-gap)">
            <ScanPrompt
              prompt="Scan the order"
              hint="Order labels start with ORD-; GS1 material labels also work."
              last={scan}
              onManual={(value) =>
                setScan({ value, ok: /^ORD-\d{4,}$/.test(value), message: 'Typed' })
              }
            />
            <TilePicker
              label="Stop reason"
              tiles={stopReasons}
              selected={reason}
              onPick={(value) => {
                setReason(value);
                feedback.play('accepted');
              }}
            />
            <BigAction
              tone={running ? 'negative' : 'positive'}
              hold
              icon={running ? <OctagonX aria-hidden /> : <Play aria-hidden />}
              label={running ? 'Request stop' : 'Request start'}
              onAction={() => setRunning(!running)}
            />
          </div>
          <div className="space-y-(--operator-gap)">
            <NumericPad
              label="Measured length"
              value={measured}
              onChange={setMeasured}
              onSubmit={(value) => {
                setRecorded(value);
                setMeasured('');
              }}
              unit="mm"
              decimals={2}
              separator=","
              tolerance={{ lower: 119.8, upper: 120.2, target: 120 }}
              // Digit keys belong to the tile picker on this screen; the pad is tapped.
              keyboard={false}
            />
            {recorded !== undefined && (
              <p role="status" className="text-(length:--operator-text)">
                Recorded {recorded} mm
              </p>
            )}
            <AttentionQueue
              items={attention}
              onResolve={(id) => setAttention((items) => items.filter((item) => item.id !== id))}
            />
            <TakeoverButton
              seat={seat}
              activity="Loading recipe R-12 · step 3 of 7"
              onTakeOver={() => setSeat('operator')}
              onHandBack={() => setSeat('agent')}
            />
          </div>
        </TabsContent>
        <TabsContent value="scanner">
          <ScannerSetup
            initial={profile}
            routes={routes}
            saved={saved}
            onSave={(next) => {
              setProfile(next);
              setSaved({ ok: true });
            }}
          />
        </TabsContent>
      </Tabs>
    </OperatorSurface>
  );
}
