import { Link } from '@tanstack/react-router';
import { ChevronLeft, Cpu, ScanBarcode, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { modeWord, type Station } from './format';

const headerButton =
  'h-(--operator-target) min-w-(--operator-target) border-0 bg-background/15 text-(length:--operator-text) text-background hover:bg-background/25 hover:text-background';

/** Back to all stations, styled for the dark station header. */
export function StationBack() {
  return (
    <Button asChild className={headerButton}>
      <Link to="/station" aria-label="All stations">
        <ChevronLeft className="size-8" aria-hidden />
      </Link>
    </Button>
  );
}

/** Who has control, and the mode, for people who cannot take over, scanner and bridge setup, and mute. */
export function StationHeaderActions({
  station,
  person,
  muted,
  onMuted,
}: {
  station: Station;
  person: boolean;
  muted: boolean;
  onMuted: (muted: boolean) => void;
}) {
  const { bridge } = station;
  const controlLabel =
    bridge.controlledBy === 'agent'
      ? 'Agent at screen'
      : bridge.controlledBy === 'operator'
        ? 'Operator has the screen'
        : 'Screen idle';
  return (
    <>
      {!person || bridge.mode === 'monitor-only' ? (
        <span className="hidden text-base leading-tight opacity-80 md:block">
          {controlLabel}
          <br />
          {bridge.mode === 'monitor-only' ? 'Watching the station screen' : modeWord[bridge.mode]}
        </span>
      ) : null}
      <Button asChild className={headerButton}>
        <Link to="/station/$stationId/devices" params={{ stationId: station.id }}>
          <ScanBarcode aria-hidden /> Scanner
        </Link>
      </Button>
      {station.role === 'supervisor' && (
        <Button asChild className={headerButton}>
          <Link to="/station/$stationId/bridge" params={{ stationId: station.id }}>
            <Cpu aria-hidden /> Bridge
          </Link>
        </Button>
      )}
      <Button
        className={headerButton}
        aria-label={muted ? 'Unmute feedback' : 'Mute feedback'}
        onClick={() => onMuted(!muted)}
      >
        {muted ? <VolumeX className="size-7" /> : <Volume2 className="size-7" />}
      </Button>
    </>
  );
}
