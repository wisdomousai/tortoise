import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { defaultWedgeProfile } from '@tortoise/devices';
import { deviceOperations } from '@tortoise/devices/contracts';
import type { OutputOf } from '@tortoise/contracts';
import { operations } from '../contracts';
import { CapabilityForm } from '@/components/capability-form';
import { OperatorHeader, OperatorSurface } from '@/components/operator-surface';
import { ScannerSetup } from '@/components/scanner-setup';
import { DeliveryBadge, Freshness } from '@/components/status-strip';
import { StationBackLink } from './station';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { client, live } from '@/lib/session';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Request failed');

/**
 * Scanner configuration for one station. Operators can test and see the profile; saving needs a
 * supervisor, which the instance enforces (the screen only reports the refusal).
 */
export function StationDevicesScreen() {
  const { stationId } = useParams({ strict: false }) as { stationId: string };
  const config = useQuery(
    live.liveQueryOptions(deviceOperations.configGet, { station: stationId }),
  );
  const [saved, setSaved] = useState<{ ok: boolean; message?: string }>();
  const [pending, setPending] = useState(false);
  if (config.error) return <p role="alert">{config.error.message}</p>;
  if (!config.data) return <p role="status">Loading device configuration…</p>;
  const data = config.data;
  const act = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      setSaved({ ok: true });
    } catch (cause) {
      setSaved({ ok: false, message: message(cause) });
    } finally {
      setPending(false);
    }
  };
  return (
    <OperatorSurface density="touch" className="min-h-0 rounded-2xl border">
      <OperatorHeader
        title="Scanner setup"
        context={`Station ${stationId} · ${data.scanners.length} saved profile(s)`}
        actions={<StationBackLink station={stationId} />}
      />
      <ScannerSetup
        // One draft per station. A save from another device updates an unedited draft and
        // conflicts with an edited one, instead of discarding the operator's edits.
        key={stationId}
        initial={data.scanners[0] ?? defaultWedgeProfile(`${stationId}-wedge`)}
        revision={data.revision}
        routes={data.routes}
        pending={pending}
        saved={saved}
        onSave={(profile, base = data.revision) =>
          void act(() =>
            client.command(
              deviceOperations.scannerSave,
              { station: stationId, profile },
              { expectedRevisions: { [`device:${stationId}`]: base } },
            ),
          )
        }
        onRemove={(id) =>
          void act(() => client.command(deviceOperations.scannerRemove, { station: stationId, id }))
        }
      />
    </OperatorSurface>
  );
}

type Station = OutputOf<typeof operations.stationGet>;
type Bridge = Station['bridge'];

function BridgeHeader({ station }: { station: Station }) {
  const { bridge } = station;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">STATION BRIDGE</p>
        <h1 className="text-2xl font-semibold">{station.name}</h1>
        <p className="text-sm text-muted-foreground">
          {bridge.profile
            ? `Profile ${bridge.profile.id}@${bridge.profile.version}`
            : 'No observation yet'}{' '}
          · screen {bridge.screen ?? 'unknown'} · <Freshness observedAt={bridge.observedAt} />
        </p>
      </div>
      <StationBackLink station={station.id} />
    </header>
  );
}

/** Mode buttons and who holds the station screen. */
function ModeCard({ bridge, onMode }: { bridge: Bridge; onMode: (mode: Bridge['mode']) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode</CardTitle>
        <CardDescription>
          Monitor-only observes. Assist runs procedures of risk level none. Actuate runs every
          declared procedure; those marked operator-present still need a person to start them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {(['monitor-only', 'assist', 'actuate'] as const).map((mode) => (
          <Button
            key={mode}
            variant={bridge.mode === mode ? 'default' : 'outline'}
            aria-pressed={bridge.mode === mode}
            onClick={() => onMode(mode)}
          >
            {mode}
          </Button>
        ))}
        <p className="w-full text-sm text-muted-foreground">
          Screen held by <strong>{bridge.controlHolder}</strong>
          {bridge.controlChangedBy ? ` (set by ${bridge.controlChangedBy})` : ''}
          {bridge.localInputAt
            ? ` · last local input ${new Date(bridge.localInputAt).toLocaleTimeString()}`
            : ''}
        </p>
      </CardContent>
    </Card>
  );
}

/** Each field with its extractor, model and confidence, so a profile or model change shows. */
function ReadingsCard({ readings }: { readings: Station['readings'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readings and their sources</CardTitle>
        <CardDescription>
          Extractor and model per field. Gate profile or model changes with{' '}
          <code>bun run station:golden</code> before deploying them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Field</th>
              <th>Value</th>
              <th>Source</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(readings).map(([field, value]) => (
              <tr key={field} className="border-t">
                <td className="py-1 font-mono">{field}</td>
                <td>{value.value === null ? '—' : String(value.value)}</td>
                <td>
                  {value.source}
                  {value.model
                    ? ` · ${value.model.id}${value.model.version ? `@${value.model.version}` : ''}`
                    : ''}
                </td>
                <td className="tabular">
                  {value.confidence.toFixed(2)}
                  {value.stale && (
                    <Badge variant="outline" className="ml-2">
                      stale
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Delivery state per target and the rejections still waiting for a decision. */
function SyncCard({ sync }: { sync: OutputOf<typeof operations.syncStatus> | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Synchronization</CardTitle>
        <CardDescription>
          {sync?.lastSyncAt
            ? `MES synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}`
            : 'MES not synced yet'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sync?.targets.map((target) => (
          <div key={target.target} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40 font-mono">{target.target}</span>
            {target.pending > 0 && <DeliveryBadge state="pending" />}
            {target.held > 0 && <DeliveryBadge state="held" />}
            <span className="text-muted-foreground">
              {target.pending} pending · {target.held} held · {target.retrying} retrying ·{' '}
              {target.accepted} accepted · {target.rejected} rejected
            </span>
          </div>
        ))}
        {sync?.rejections.map((rejection) => (
          <p key={rejection.resource} className="text-sm">
            <DeliveryBadge state="rejected" reason={rejection} /> {rejection.resource}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Supervisor view of one station bridge: what it may do, who holds the screen, how its readings
 * were produced and what is waiting to reach the MES or the station software.
 */
export function StationBridgeScreen() {
  const { stationId } = useParams({ strict: false }) as { stationId: string };
  const station = useQuery(live.liveQueryOptions(operations.stationGet, { station: stationId }));
  const sync = useQuery(live.liveQueryOptions(operations.syncStatus, {}));
  const [error, setError] = useState<string>();
  if (station.error) return <p role="alert">{station.error.message}</p>;
  if (!station.data) return <p role="status">Loading bridge…</p>;
  const { bridge, readings } = station.data;
  const setMode = async (mode: typeof bridge.mode) => {
    setError(undefined);
    try {
      await client.command(operations.bridgeSetMode, { station: stationId, mode });
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <div className="space-y-6">
      <BridgeHeader station={station.data} />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <ModeCard bridge={bridge} onMode={(mode) => void setMode(mode)} />
        <ReadingsCard readings={readings} />
        <SyncCard sync={sync.data} />
        <Card>
          <CardHeader>
            <CardTitle>Station access</CardTitle>
            <CardDescription>
              Grant operator, supervisor or viewer roles. Integration principals cannot hold one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CapabilityForm
              capability={operations.stationSetMember}
              fixed={{ station: stationId }}
              submitLabel="Update station role"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
