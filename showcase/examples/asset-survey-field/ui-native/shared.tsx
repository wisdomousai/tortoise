import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import type { ScanEvent } from '@tortoise/devices/scanner/decode';
import type { ScannerProfile } from '@tortoise/devices/scanner/profile';
import { intentSource } from '@tortoise/intent-scanner/expo';

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function Screen({ children }: { children: ReactNode }) {
  return <View className="flex-1 gap-4 bg-background p-4">{children}</View>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Text className="text-base text-destructive">{message(error)}</Text>;
}

/** A plain glove-sized button, for actions that need no hold. */
export function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className="min-h-target items-center justify-center rounded-xl border border-border px-4 disabled:opacity-50"
    >
      <Text className="text-operator font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}

export function Empty({ children }: { children: string }) {
  return <Text className="text-operator text-muted-foreground">{children}</Text>;
}

/**
 * The intent profile of a Zebra device with DataWedge set to broadcast this action. Honeywell
 * devices send the data in the `data` extra instead; see the intent-scanner README.
 */
export const scannerProfile: ScannerProfile = {
  id: 'zebra-datawedge',
  label: 'Zebra DataWedge',
  transport: 'intent',
  terminator: 'none',
  maxGapMs: 50,
  minLength: 1,
  aimIds: false,
  scannerLayout: 'us',
  intent: { action: 'dev.tortoise.SCAN', dataExtra: 'com.symbol.datawedge.data_string' },
};

/**
 * Scans from the device's imager while the screen is mounted. Android only: iOS builds leave the
 * intent scanner out, and a device without the receiver reports the source unsupported, which
 * leaves typing as the way to search.
 */
export function useScans(onScan: (scan: ScanEvent) => void) {
  const handler = useRef(onScan);
  handler.current = onScan;
  const source = useMemo(
    () => (Platform.OS === 'android' ? intentSource(scannerProfile) : undefined),
    [],
  );
  useEffect(() => {
    if (!source) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    source.start({ onScan: (scan) => handler.current(scan) }).then(
      (stopper) => (cancelled ? stopper() : (stop = stopper)),
      () => undefined,
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [source]);
}
