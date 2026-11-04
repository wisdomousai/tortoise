import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Link2, MonitorSmartphone } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { HoldButton } from '@tortoise/frame-native/components/hold-button';
import { ListRow } from '@tortoise/frame-native/components/list-row';
import { StatusPill } from '@tortoise/frame-native/components/status-pill';
import { definePluginNativeScreens } from '@tortoise/frame-native/plugin-screens';
import { useSession } from '@tortoise/frame-native/session';
import { hubLinkOperations as ops } from '../contracts';
import type { HubLinkService } from '../pairing';
import { HubView } from './hub-view';

const field = 'min-h-target rounded-xl border border-border px-4 text-operator text-foreground';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Pairing on the device (`hub.pairing.get`): the hub and device name when paired, otherwise a
 * form for the hub address and the code shown on the hub. Unpairing deletes the credential; the
 * hub keeps listing the device until someone revokes it there.
 */
function Pairing() {
  const { live, services } = useSession();
  const pairing = services['hub-link'] as HubLinkService | undefined;
  const status = useQuery(live.liveQueryOptions(ops.pairingGet, {}));
  const [origin, setOrigin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!pairing)
    return (
      <View className="flex-1 bg-background p-4">
        <StatusPill signal="fault" label="Pairing is not available in this app" />
      </View>
    );
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    action()
      .catch((reason: unknown) => setError(message(reason)))
      .finally(() => setBusy(false));
  };
  const paired = status.data?.pairing;
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      {paired ? (
        <>
          <StatusPill signal="ok" label={`Paired as ${paired.label}`} />
          <ListRow title={paired.origin} detail={paired.kind === 'attached' ? 'Tablet' : 'Phone'} />
          <HoldButton
            label="Unpair"
            holdingLabel="Keep holding to unpair"
            tone="fault"
            disabled={busy}
            onConfirm={() => run(() => pairing.unpair())}
          />
        </>
      ) : (
        <>
          <StatusPill
            signal={status.data?.lastError ? 'attention' : 'idle'}
            label={status.data?.lastError ?? 'Not paired'}
          />
          <TextInput
            value={origin}
            onChangeText={setOrigin}
            placeholder="https://hub.site"
            accessibilityLabel="Hub address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className={field}
          />
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Code from the hub"
            accessibilityLabel="Enrollment code"
            autoCapitalize="characters"
            autoCorrect={false}
            className={field}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !origin.trim() || !code.trim()}
            onPress={() => run(() => pairing.pair({ origin: origin.trim(), code: code.trim() }))}
            className="min-h-target items-center justify-center rounded-xl bg-primary px-4 disabled:opacity-50"
          >
            <Text className="text-operator font-semibold text-primary-foreground">
              {busy ? 'Pairing…' : 'Pair'}
            </Text>
          </Pressable>
        </>
      )}
      {error ? <Text className="text-base text-destructive">{error}</Text> : null}
    </View>
  );
}

/**
 * The pairing screen, the hub's own screens for an attached tablet, their tabs, and the screen the
 * `hub.*` capabilities open.
 */
export const hubLinkNativeScreens = definePluginNativeScreens({
  id: 'hub-link',
  routes: [
    { path: '/hub', title: 'Hub', component: Pairing },
    { path: '/hub/screens', title: 'Hub screens', component: HubView },
  ],
  navigation: [
    { to: '/hub', label: 'Hub', icon: Link2 },
    { to: '/hub/screens', label: 'Hub screens', icon: MonitorSmartphone },
  ],
  capabilityScreens: [{ prefix: 'hub.', to: '/hub' }],
});
