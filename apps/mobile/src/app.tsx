import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import entry from 'virtual:agent-native/mobile-entry';
import { NativeFrame } from '@agent-native/frame-native/frame';
import { openMobileAuthority, type MobileAuthority } from '@agent-native/mobile';
import { expoPlatform, followAppState } from '@agent-native/mobile/expo';

let opening: Promise<MobileAuthority> | undefined;

/**
 * The app's one authority. The screens and the background task share it: ownership refuses a
 * second one, and the OS may start the runtime for the task before any screen mounts. A failed
 * open is forgotten so the next call retries.
 */
export function authority(): Promise<MobileAuthority> {
  opening ??= openMobileAuthority(entry.application, { platform: expoPlatform() }).catch(
    (error: unknown) => {
      opening = undefined;
      throw error;
    },
  );
  return opening;
}

/** Opens the configured application and renders its native screens. */
export function App() {
  const [state, setState] = useState<
    { opened: MobileAuthority } | { failed: string } | undefined
  >();
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    authority().then(
      (opened) => {
        if (cancelled) return;
        stop = followAppState(opened);
        setState({ opened });
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
    return <NativeFrame screens={entry.screens} transport={state.opened.transport} />;
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
