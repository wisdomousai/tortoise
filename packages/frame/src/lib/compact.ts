import { useSyncExternalStore } from 'react';

/**
 * Below the shell's two-column breakpoint (Tailwind `lg`, 64rem): phones, and tablets in portrait
 * or in a hub's web view. The shell collapses its sidebar into a menu there, and a screen that
 * declares a `compact` variant renders it instead.
 */
export const compactQuery = '(max-width: 63.999rem)';

const subscribe = (change: () => void) => {
  const query = matchMedia(compactQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};

/** Whether the viewport is compact now; follows rotation and window resizing. */
export function useCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(compactQuery).matches,
    () => false,
  );
}
