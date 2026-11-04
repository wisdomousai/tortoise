import { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { deviceOperations } from '@tortoise/devices/contracts';
import { defineFeatureScreens } from '@tortoise/frame/feature-screens';
import { ScannerSetup } from '@/components/scanner-setup';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client, live } from '@/lib/session';
import { counterProfile, counterRoutes, counterStation } from '../scanner';

export const scannerPath = '/scanner';

/**
 * Set up the counter's keyboard-wedge scanner: calibrate it from one scan, test it against the
 * routes in effect and save its profile through the device feature. Each save carries the revision
 * the draft started from, so it never overwrites a change made elsewhere. Routes are shown here and
 * changed over the CLI or MCP with `device.routes.save`.
 */
function ScannerScreen() {
  const config = useQuery(
    live.liveQueryOptions(deviceOperations.configGet, { station: counterStation }),
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; message?: string }>();
  if (config.isError) return <p className="text-muted-foreground">Scanner setup unavailable.</p>;
  if (!config.data) return null;
  const stored = config.data.scanners.find((scanner) => scanner.transport === 'wedge');
  const routes = config.data.routes.length ? config.data.routes : counterRoutes;
  const run = async (command: () => Promise<unknown>) => {
    setPending(true);
    setSaved(undefined);
    try {
      await command();
      setSaved({ ok: true });
    } catch (error) {
      setSaved({ ok: false, message: error instanceof Error ? error.message : 'Not saved' });
    } finally {
      setPending(false);
    }
  };
  const options = (base: number | undefined) => ({
    idempotencyKey: crypto.randomUUID(),
    ...(base === undefined ? {} : { expectedRevisions: { [`device:${counterStation}`]: base } }),
  });
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Scanner</h1>
        <p className="text-sm text-muted-foreground">
          The keyboard-wedge scanner at the store counter. Until a profile is saved, the counter
          uses a US-layout scanner that ends each code with Enter.
        </p>
      </header>
      <ScannerSetup
        initial={stored ?? counterProfile}
        revision={config.data.revision}
        routes={routes}
        pending={pending}
        saved={saved}
        onSave={(profile, base) =>
          void run(() =>
            client.command(
              deviceOperations.scannerSave,
              { station: counterStation, profile },
              options(base),
            ),
          )
        }
        onRemove={
          stored
            ? (id) =>
                void run(() =>
                  client.command(
                    deviceOperations.scannerRemove,
                    { station: counterStation, id },
                    options(config.data.revision),
                  ),
                )
            : undefined
        }
      />
      <section aria-label="Scan routes" className="space-y-3">
        <h2 className="text-base font-medium">Scan routes</h2>
        <p className="text-sm text-muted-foreground">
          {config.data.routes.length
            ? 'The routes saved for the counter station.'
            : 'The default routes: none are saved for the counter station.'}{' '}
          The first matching route wins.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Intent</TableHead>
              <TableHead>Pattern</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => (
              <TableRow key={`${route.intent}-${route.pattern ?? route.gs1Ai}`}>
                <TableCell>{route.intent}</TableCell>
                <TableCell className="font-mono">
                  {route.pattern ?? `GS1 (${route.gs1Ai})`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

/** The device feature's screen: setup for the counter's scanner. */
export const deviceScreens = defineFeatureScreens({
  id: 'device',
  routes: [{ path: 'scanner', component: ScannerScreen }],
  navigation: [{ to: scannerPath, label: 'Scanner', icon: ScanBarcode }],
  capabilityScreens: [{ prefix: 'device.', to: scannerPath }],
});
