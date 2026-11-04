import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { defaultWedgeProfile, type ScannerProfile, type ScanRoute } from '@tortoise/devices';
import { BigAction } from '@/components/big-action';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import { TilePicker } from '@/components/tile-picker';
import { useFeedback } from '@/hooks/use-feedback';
import { useScanner } from '@/hooks/use-scanner';
import { client, live } from '@/lib/session';
import { operations } from '../../contracts';
import type { Station } from './format';
import type { Run } from './use-station-commands';

/**
 * The order the operator is about to start, chosen by scan, typing or picking. Only a released
 * order for this station becomes the candidate; anything else is refused audibly.
 */
function useOrderChoice(
  station: Station,
  person: boolean,
  profile: ScannerProfile | undefined,
  routes: readonly ScanRoute[],
) {
  const feedback = useFeedback();
  const orders = useQuery(live.liveQueryOptions(operations.orderList, { station: station.id }));
  const [candidate, setCandidate] = useState<string>();
  const [scan, setScan] = useState<ScanOutcome>();
  const released = (orders.data?.items ?? []).filter((order) => order.status === 'released');
  const choose = (value: string, how: string) => {
    const found = released.find((order) => order.id === value);
    setScan({
      value,
      ok: found !== undefined,
      message: found ? `${how}: ${found.materialText}` : 'Not a released order for this station',
    });
    feedback.play(found ? 'scan' : 'rejected');
    setCandidate(found?.id);
  };
  const scanner = useScanner({
    profile: profile ?? defaultWedgeProfile(),
    routes,
    enabled: person,
    onRoute: (routed) => routed.intent === 'order' && choose(routed.value, 'Scanned'),
  });
  return { released, candidate, setCandidate, scan, scanner, choose };
}

/** Scan, type or pick a released order, then hold to start it and load its recipe. */
export function OrderTask({
  station,
  person,
  pending,
  run,
  profile,
  routes,
}: {
  station: Station;
  person: boolean;
  pending: string | undefined;
  run: Run;
  profile: ScannerProfile | undefined;
  routes: readonly ScanRoute[];
}) {
  const { released, candidate, setCandidate, scan, scanner, choose } = useOrderChoice(
    station,
    person,
    profile,
    routes,
  );
  const chosen = released.find((order) => order.id === candidate);
  const loading = station.desired?.sync === 'pending';
  if (!person) return null;
  return (
    <div className="space-y-(--operator-gap)">
      <ScanPrompt
        prompt="Scan the next order"
        hint={
          scanner.error ??
          'Starting an order loads its recipe on the station screen. The machine must be stopped.'
        }
        last={scan}
        onManual={(value) => choose(value.trim(), 'Typed')}
      />
      {released.length > 0 && (
        <TilePicker
          label="Released orders"
          tiles={released.map((order) => ({
            value: order.id,
            label: order.id,
            detail: `${order.recipe} · ${order.materialText}`,
          }))}
          selected={candidate}
          onPick={(value) => choose(value, 'Picked')}
          hotkeys={false}
        />
      )}
      {chosen && (
        <BigAction
          tone="positive"
          hold
          icon={<PackageCheck aria-hidden />}
          label={`Start ${chosen.id}`}
          description={`Hold to load recipe ${chosen.recipe} on the station`}
          pending={pending === 'start'}
          disabled={loading}
          onAction={() =>
            void run('start', () =>
              client.command(operations.orderStart, { station: station.id, orderId: chosen.id }),
            ).then((ok) => ok && setCandidate(undefined))
          }
        />
      )}
    </div>
  );
}
