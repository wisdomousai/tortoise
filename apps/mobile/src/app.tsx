import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import entry from 'virtual:agent-native/mobile-entry';
import { NativeFrame } from '@agent-native/frame-native/frame';
import {
  connectMobileShell,
  openMobileInstance,
  type MobileInstance,
  type MobileOsConnection,
} from '@agent-native/mobile';
import { expoOsBindings, expoPlatform, followAppState } from '@agent-native/mobile/expo';

let opening: Promise<MobileInstance> | undefined;

/**
 * The app's one instance. The screens and the background task share it: ownership refuses a
 * second one, and the OS may start the runtime for the task before any screen mounts. A failed
 * open is forgotten so the next call retries.
 */
export function instance(): Promise<MobileInstance> {
  opening ??= openMobileInstance(entry.application, {
    platform: expoPlatform(),
    settings: entry.settings,
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

let os: MobileOsConnection | undefined;

/**
 * The app's one OS connection: links and files the OS opens the app with, submitted to the
 * instance's shell port. Made once, with the screens, so the background task never takes OS
 * input; what arrives before the frame mounts waits for it.
 */
function osConnection(opened: MobileInstance): MobileOsConnection {
  os ??= connectMobileShell(
    opened,
    entry.application,
    expoOsBindings(entry.identity.scheme, (message) => console.warn(`[os] ${message}`)),
  );
  return os;
}

/** Opens the configured application and renders its native screens. */
export function App() {
  const [state, setState] = useState<
    { opened: MobileInstance; os: MobileOsConnection } | { failed: string } | undefined
  >();
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    instance().then(
      (opened) => {
        if (cancelled) return;
        stop = followAppState(opened);
        setState({ opened, os: osConnection(opened) });
      },
      (error: unknown) => {
        if (!cancelled)
          setState({ failed: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  if (state && 'opened' in state)
    return (
      <NativeFrame
        screens={entry.screens}
        transport={state.opened.transport}
        services={state.opened.instance.services}
        os={state.os.deliveries}
      />
    );
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
      {state ? (
        <Text accessibilityRole="alert" className="text-operator text-foreground">
          {`${entry.screens.title ?? entry.application.manifest.title} cannot open: ${state.failed}`}
        </Text>
      ) : (
        <ActivityIndicator size="large" accessibilityLabel="Opening" />
      )}
    </View>
  );
}
