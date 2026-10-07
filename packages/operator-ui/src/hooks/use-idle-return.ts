import * as React from 'react';

/**
 * Return a shared station to its home state after inactivity, so the next operator never acts on
 * the previous operator's half-finished context. Any pointer, key or scan input resets the timer.
 * Pass `active: false` while work is legitimately paused (for example during a pending command).
 */
export function useIdleReturn(
  onIdle: () => void,
  { idleMs = 120_000, active = true }: { idleMs?: number; active?: boolean } = {},
) {
  const callback = React.useRef(onIdle);
  callback.current = onIdle;
  React.useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let timer = setTimeout(() => callback.current(), idleMs);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), idleMs);
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const type of events)
      window.addEventListener(type, reset, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, reset, { capture: true });
    };
  }, [idleMs, active]);
}
