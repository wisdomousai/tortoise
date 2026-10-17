import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { ScanBarcode } from 'lucide-react-native';
import type { ScanEvent } from '@agent-native/devices/scanner/decode';
import type { ScannerProfile } from '@agent-native/devices/scanner/profile';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { definePluginNativeScreens } from '@agent-native/frame-native/plugin-screens';
import { intentSource } from './source';

const kept = 20;

function ScannerTest({ profile }: { profile: ScannerProfile }) {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string>();
  const source = useMemo(() => intentSource(profile), [profile]);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    source.start({ onScan: (scan) => setScans((list) => [scan, ...list].slice(0, kept)) }).then(
      (stopper) => (cancelled ? stopper() : (stop = stopper)),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [source]);
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <StatusPill
        signal={error ? 'fault' : 'ok'}
        label={error ?? `Listening for ${profile.intent?.action ?? 'no action'}`}
      />
      <Text className="text-base text-muted-foreground">
        {`Data extra: ${profile.intent?.dataExtra ?? 'none'}`}
      </Text>
      <FlatList
        data={scans}
        keyExtractor={(scan, index) => `${scan.at}-${index}`}
        renderItem={({ item }) => (
          <ListRow title={item.data} detail={item.gs1?.valid ? 'GS1' : item.symbology} />
        )}
        ListEmptyComponent={
          <Text className="text-operator text-muted-foreground">Scan a code to test.</Text>
        }
      />
    </View>
  );
}

/**
 * A screen that listens with one profile and lists the decoded scans, for setting up the
 * device's scanner app. The application passes the profile it uses.
 */
export function intentScannerScreens(profile: ScannerProfile) {
  return definePluginNativeScreens({
    id: 'intent-scanner',
    routes: [
      {
        path: '/scanner/intent',
        title: 'Scanner test',
        component: () => <ScannerTest profile={profile} />,
      },
    ],
    navigation: [{ to: '/scanner/intent', label: 'Scanner', icon: ScanBarcode }],
  });
}
