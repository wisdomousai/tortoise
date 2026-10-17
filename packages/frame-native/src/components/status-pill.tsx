import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  type LucideIcon,
} from 'lucide-react-native';

/** The station signals of the operator registry, with the same names and colors. */
export type Signal = 'ok' | 'pending' | 'attention' | 'fault' | 'idle';

// Full class names: Tailwind finds classes by scanning the source, not by running it.
const signals: Record<Signal, { icon: LucideIcon; box: string; text: string; color: string }> = {
  ok: {
    icon: CircleCheck,
    box: 'bg-op-ok',
    text: 'text-op-ok-foreground',
    color: '--color-op-ok-foreground',
  },
  pending: {
    icon: Clock,
    box: 'bg-op-pending',
    text: 'text-op-pending-foreground',
    color: '--color-op-pending-foreground',
  },
  attention: {
    icon: CircleAlert,
    box: 'bg-op-attention',
    text: 'text-op-attention-foreground',
    color: '--color-op-attention-foreground',
  },
  fault: {
    icon: CircleX,
    box: 'bg-op-fault',
    text: 'text-op-fault-foreground',
    color: '--color-op-fault-foreground',
  },
  idle: {
    icon: CircleDashed,
    box: 'bg-op-idle',
    text: 'text-op-idle-foreground',
    color: '--color-op-idle-foreground',
  },
};

/**
 * A state as icon plus word, never color alone, so it reads in sunlight, in grayscale and to
 * a screen reader. Use it for sync state (pending, accepted, rejected) and equipment condition.
 */
export function StatusPill({ signal, label }: { signal: Signal; label: string }) {
  const { icon: Icon, box, text, color: variable } = signals[signal];
  // Icons take a color, not a class, so the theme variable is read directly.
  const color = useCSSVariable(variable);
  return (
    <View
      accessible
      accessibilityLabel={label}
      className={`flex-row items-center gap-2 self-start rounded-full px-3 py-1.5 ${box}`}
    >
      <Icon size={20} color={typeof color === 'string' ? color : undefined} />
      <Text className={`text-base font-semibold ${text}`}>{label}</Text>
    </View>
  );
}
