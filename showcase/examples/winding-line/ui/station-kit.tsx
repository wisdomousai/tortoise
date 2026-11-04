import { useMemo, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { defaultWedgeProfile, type ScanRoute, type ScannerProfile } from '@tortoise/devices';
import {
  OperatorHeader,
  OperatorSurface,
  type OperatorDensity,
} from '@/components/operator-surface';
import { ScannerSetup } from '@/components/scanner-setup';
import { DeliveryBadge, Freshness, StatusPill, StatusStrip } from '@/components/status-strip';
import type { ControlHolder } from '@/components/takeover-button';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFeedback } from '@/hooks/use-feedback';
import { useScanner } from '@/hooks/use-scanner';
import { useStationDemo } from './station-kit/demo';
import { StationTab } from './station-kit/station-tab';

const routes: readonly ScanRoute[] = [
  { intent: 'order', pattern: '^ORD-(\\d{4,})$' },
  { intent: 'material', gs1Ai: '01' },
];

/** Density, contrast and mute: the settings a panel is judged under. */
function DisplayControls({
  density,
  onDensity,
  contrast,
  onContrast,
  feedback,
}: {
  density: OperatorDensity;
  onDensity: (density: OperatorDensity) => void;
  contrast: 'normal' | 'high';
  onContrast: (contrast: 'normal' | 'high') => void;
  feedback: ReturnType<typeof useFeedback>;
}) {
  return (
    <>
      {(['glove', 'touch', 'desk'] as const).map((option) => (
        <Button
          key={option}
          variant={density === option ? 'default' : 'outline'}
          className="h-(--operator-target) text-(length:--operator-text)"
          aria-pressed={density === option}
          onClick={() => onDensity(option)}
        >
          {option}
        </Button>
      ))}
      <Button
        variant="outline"
        className="h-(--operator-target) text-(length:--operator-text)"
        aria-pressed={contrast === 'high'}
        onClick={() => onContrast(contrast === 'high' ? 'normal' : 'high')}
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
  );
}

/** Every status pill and delivery badge state the station uses. */
function KitStatus({
  running,
  holder,
  started,
}: {
  running: boolean;
  holder: ControlHolder;
  started: number;
}) {
  return (
    <StatusStrip>
      <StatusPill
        signal={running ? 'ok' : 'fault'}
        label={running ? 'Running' : 'Stopped'}
        detail={<Freshness observedAt={started} />}
      />
      <StatusPill signal="pending" label="Monitor only" detail="Bridge mode" />
      <StatusPill
        signal={holder === 'agent' ? 'attention' : 'idle'}
        label={
          holder === 'agent'
            ? 'Agent at screen'
            : holder === 'operator'
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
  );
}

/**
 * Gallery of the operator registry at every density, wired to local state only. It is the
 * interaction target for browser tests (hold-to-confirm, tap guard, digit hotkeys, keypad) and
 * the place to judge the primitives on a real panel with gloves on. No capability is bound here.
 */
export function StationKitScreen() {
  const [density, setDensity] = useState<OperatorDensity>('glove');
  const [contrast, setContrast] = useState<'normal' | 'high'>('normal');
  const [profile, setProfile] = useState<ScannerProfile>(() => defaultWedgeProfile('kit-wedge'));
  const [saved, setSaved] = useState<{ ok: boolean; message?: string }>();
  const [tab, setTab] = useState('station');
  const demo = useStationDemo();
  const feedback = useFeedback();
  const started = useMemo(() => Date.now(), []);
  useScanner({
    profile,
    routes,
    enabled: tab === 'station',
    onScan: (event) => {
      feedback.play('scan');
      demo.setScan({ value: event.data, ok: false, message: 'Not an order or material label' });
    },
    onRoute: (routed) => {
      feedback.play('accepted');
      demo.setScan({ value: routed.value, ok: true, message: `Recognized as ${routed.intent}` });
    },
  });

  return (
    <OperatorSurface density={density} contrast={contrast} className="min-h-0 rounded-2xl border">
      <OperatorHeader
        title="Operator kit"
        context="Line 3 · Station 2 · gallery, no data is written"
        actions={
          <DisplayControls
            density={density}
            onDensity={setDensity}
            contrast={contrast}
            onContrast={setContrast}
            feedback={feedback}
          />
        }
      />
      <KitStatus running={demo.running} holder={demo.holder} started={started} />
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
          <StationTab demo={demo} feedback={feedback} />
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
