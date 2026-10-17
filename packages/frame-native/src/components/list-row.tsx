import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

/**
 * A list row sized for a gloved thumb: at least the glove target high, the whole row pressable,
 * a title that wraps instead of truncating (designations are long) and an optional trailing slot
 * for a status pill. Without `onPress` it renders as plain content.
 */
export function ListRow({
  title,
  detail,
  leading,
  trailing,
  onPress,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const muted = useCSSVariable('--color-muted-foreground');
  const body = (
    <View className="min-h-target flex-row items-center gap-4 border-b border-border px-4 py-3">
      {leading}
      <View className="flex-1 gap-1">
        <Text className="text-operator font-medium text-foreground">{title}</Text>
        {detail ? <Text className="text-base text-muted-foreground">{detail}</Text> : null}
      </View>
      {trailing}
      {onPress ? (
        <ChevronRight size={24} color={typeof muted === 'string' ? muted : undefined} />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={onPress}
      className="active:bg-muted"
    >
      {body}
    </Pressable>
  );
}
