import * as React from 'react';
import {
  createCameraSource,
  createHidPosSource,
  createScanRouter,
  createSerialSource,
  createWedgeSource,
  defaultWedgeProfile,
  type RoutedScan,
  type ScanEvent,
  type ScanRoute,
  type ScannerProfile,
  type ScannerSource,
} from '@agent-native/devices';

export type InputChannel = 'keyboard' | 'scanner' | 'touch';

function sourceFor(profile: ScannerProfile, video?: HTMLVideoElement): ScannerSource | undefined {
  switch (profile.transport) {
    case 'wedge':
      return createWedgeSource(profile);
    case 'serial':
      return createSerialSource(profile);
    case 'hid-pos':
      return createHidPosSource(profile);
    case 'camera':
      return createCameraSource(profile, video ? { video } : {});
    default:
      // Host-plugin sources need the host's bridge; compose them with `createHostPluginSource`.
      return undefined;
  }
}

/**
 * Scanner input for a station screen. Keyboard-wedge profiles start automatically. Serial, HID
 * and camera profiles need a user gesture for the browser's device prompt, so call `connect`
 * from a button. Each scan is decoded with the profile and matched against the station's routes;
 * `onRoute` receives the intent, `onScan` every scan. `channel` records how the last value
 * arrived, so a datapoint can report its input channel.
 */
export function useScanner({
  profile = defaultWedgeProfile(),
  routes = [],
  onScan,
  onRoute,
  enabled = true,
  video,
}: {
  profile?: ScannerProfile;
  routes?: readonly ScanRoute[];
  onScan?: (event: ScanEvent) => void;
  onRoute?: (routed: RoutedScan) => void;
  enabled?: boolean;
  video?: HTMLVideoElement | null;
} = {}) {
  const [last, setLast] = React.useState<{ scan: ScanEvent; routed?: RoutedScan }>();
  const [channel, setChannel] = React.useState<InputChannel>('keyboard');
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const handlers = React.useRef({ onScan, onRoute });
  handlers.current = { onScan, onRoute };
  const router = React.useMemo(() => createScanRouter(routes), [routes]);
  const stop = React.useRef<(() => void) | undefined>(undefined);

  const connect = React.useCallback(async () => {
    const source = sourceFor(profile, video ?? undefined);
    if (!source?.isSupported()) {
      setError(`${profile.transport} scanning is not available on this device`);
      return;
    }
    stop.current?.();
    try {
      stop.current = await source.start({
        onScan: (scan) => {
          const routed = router.route(scan);
          setLast({ scan, ...(routed ? { routed } : {}) });
          setChannel('scanner');
          handlers.current.onScan?.(scan);
          if (routed) handlers.current.onRoute?.(routed);
        },
        onError: (failure) => setError(failure.message),
      });
      setConnected(true);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Scanner unavailable');
      setConnected(false);
    }
  }, [profile, router, video]);

  React.useEffect(() => {
    if (enabled && profile.transport === 'wedge') void connect();
    return () => {
      stop.current?.();
      stop.current = undefined;
      setConnected(false);
    };
  }, [enabled, profile.transport, connect]);

  return {
    last,
    channel,
    connected,
    error,
    connect,
    /** Call from touch handlers so telemetry attributes the value to touch input. */
    markTouch: React.useCallback(() => setChannel('touch'), []),
    markKeyboard: React.useCallback(() => setChannel('keyboard'), []),
  };
}
