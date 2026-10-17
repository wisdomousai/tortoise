import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * Hold-to-confirm on a touch screen. A deliberate hold replaces a confirmation dialog: a brushed
 * touch or a glove resting on the glass cannot trigger it, and it needs no second precise tap.
 * Lifting early aborts, and so does sliding off the button, which React Native reports as a
 * press-out. After a confirmation the finger must lift before the button can confirm again.
 * The same rules as the web operator registry's `usePressAndHold`, on press events.
 */
export function useHold({
  durationMs = 900,
  disabled = false,
  onConfirm,
}: {
  durationMs?: number;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | undefined>(undefined);
  const started = useRef<number | undefined>(undefined);
  const latched = useRef(false);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  const cancel = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    started.current = undefined;
    setProgress(0);
  }, []);
  const release = useCallback(() => {
    latched.current = false;
    cancel();
  }, [cancel]);
  const begin = useCallback(() => {
    if (disabled || latched.current || started.current !== undefined) return;
    started.current = performance.now();
    const tick = () => {
      if (started.current === undefined) return;
      const value = Math.min(1, (performance.now() - started.current) / durationMs);
      setProgress(value);
      if (value >= 1) {
        latched.current = true;
        started.current = undefined;
        frame.current = undefined;
        confirm.current();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [disabled, durationMs]);

  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  return { progress, holding: progress > 0 && progress < 1, onPressIn: begin, onPressOut: release };
}

const tones = {
  primary: 'bg-primary',
  fault: 'bg-op-fault',
} as const;
const labels = {
  primary: 'text-primary-foreground',
  fault: 'text-op-fault-foreground',
} as const;

/**
 * A full-width, glove-sized button that confirms after a hold, for consequential actions such as
 * submitting or discarding a capture. A bar fills while it is held; screen readers get the
 * label and the hint to hold.
 */
export function HoldButton({
  label,
  holdingLabel = 'Keep holding',
  onConfirm,
  tone = 'primary',
  disabled,
  durationMs,
  icon,
}: {
  label: string;
  holdingLabel?: string;
  onConfirm: () => void;
  tone?: keyof typeof tones;
  disabled?: boolean;
  durationMs?: number;
  icon?: ReactNode;
}) {
  const hold = useHold({ onConfirm, disabled, durationMs });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to confirm"
      accessibilityState={{ disabled: !!disabled, busy: hold.holding }}
      // Assistive technologies activate instead of holding; their activation is deliberate.
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate' && !disabled) onConfirm();
      }}
      accessibilityActions={[{ name: 'activate' }]}
      onPressIn={hold.onPressIn}
      onPressOut={hold.onPressOut}
      disabled={disabled}
      className={`min-h-target overflow-hidden rounded-xl ${tones[tone]} ${disabled ? 'opacity-50' : ''}`}
    >
      <View
        className="absolute inset-y-0 left-0 bg-black/25"
        style={{ width: `${Math.round(hold.progress * 100)}%` }}
      />
      <View className="min-h-target flex-row items-center justify-center gap-3 px-6">
        {icon}
        <Text className={`text-operator font-semibold ${labels[tone]}`}>
          {hold.holding ? holdingLabel : label}
        </Text>
      </View>
    </Pressable>
  );
}
