import { Pressable, Text, View } from 'react-native';
import type { OsProvenance } from '@tortoise/contracts';
import { describeProvenance } from '@tortoise/shell/provenance';
import { useShownProvenance } from './os-deliveries';

/**
 * Where an OS request came from, above the screen or form it opened. `prepared` adds that the
 * values were filled in and nothing is saved until the person confirms. The label comes from
 * the sender and is rendered as text only.
 */
export function OsProvenanceNotice({
  provenance,
  prepared = false,
  onDismiss,
}: {
  provenance: OsProvenance;
  prepared?: boolean;
  onDismiss: () => void;
}) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-3 border-b border-border bg-muted px-4 py-3"
    >
      <View className="flex-1 gap-1">
        <Text className="text-base font-medium text-foreground">
          {describeProvenance(provenance)}
        </Text>
        {prepared ? (
          <Text className="text-base text-muted-foreground">
            Check the values; nothing is saved until you confirm.
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        className="min-h-target justify-center px-3 active:opacity-70"
      >
        <Text className="text-base font-medium text-foreground">Dismiss</Text>
      </Pressable>
    </View>
  );
}

/** The provenance of the last screen an OS request opened, until dismissed. */
export function ShownProvenance() {
  const { shown, dismiss } = useShownProvenance();
  return shown ? <OsProvenanceNotice provenance={shown.provenance} onDismiss={dismiss} /> : null;
}
