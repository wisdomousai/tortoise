import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { UiResource } from './ui-intents';

/**
 * The records the current screen shows or has selected, handed to the assistant panel. The panel
 * sits beside the routes and starts runs from its own UI session, so a screen's own
 * `useUiSession` would not reach them: a screen publishes its records here while it is mounted,
 * and the panel selects them in its session, so the next run's context names them.
 */
export interface ShownRecord extends UiResource {
  /** What the panel shows for the record, such as its number or name. */
  readonly label?: string;
}

const none: readonly ShownRecord[] = [];
let shown = none;
const listeners = new Set<() => void>();
function setShown(records: readonly ShownRecord[]) {
  shown = records;
  for (const listener of listeners) listener();
}

/**
 * Publish the screen's records, the record it shows first, while the screen is mounted. A screen
 * that unmounts clears only what it published, so the next screen's records stay when its effect
 * runs first.
 */
export function useAssistantContext(records: readonly ShownRecord[]) {
  const key = JSON.stringify(records);
  useEffect(() => {
    const published = JSON.parse(key) as readonly ShownRecord[];
    setShown(published);
    return () => {
      if (shown === published) setShown(none);
    };
  }, [key]);
}

/** The records the current screen published; empty when it publishes none. */
export function useShownRecords() {
  return useSyncExternalStore(
    (change) => {
      listeners.add(change);
      return () => listeners.delete(change);
    },
    () => shown,
  );
}

type Selector = (resource: string) => boolean;
let selector: { readonly current: Selector } | undefined;

/**
 * Let a run's `ui.select` reach this screen while it is mounted: `select` selects `<kind>:<id>`
 * as the person's own control does, and returns false when the screen does not show it.
 */
export function useAssistantSelect(select: Selector) {
  const latest = useRef(select);
  latest.current = select;
  useEffect(() => {
    const own = latest;
    selector = own;
    return () => {
      if (selector === own) selector = undefined;
    };
  }, []);
}

/**
 * Select `<kind>:<id>` on the current screen for a run's `ui.select`. A record the screen already
 * publishes counts as selected; otherwise the screen's selector selects it, and this throws, so
 * the intent is rejected, when the screen does not show it.
 */
export async function selectOnScreen(resource: string) {
  if (shown.some((record) => record.id === resource)) return;
  if (!selector?.current(resource)) throw new Error(`This screen does not show ${resource}`);
}
