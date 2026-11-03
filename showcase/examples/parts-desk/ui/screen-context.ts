import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import type { ScreenRecord } from './screen-records';

/**
 * The records the current screen shows and the person has selected on it, handed to the
 * assistant panel. The panel sits beside the routes and starts the runs from its own UI session,
 * so a screen's own `useUiSession` would not reach them: each screen publishes its records here
 * while it is mounted, and the panel selects them in its session.
 */
const none: readonly ScreenRecord[] = [];
let shown = none;
const listeners = new Set<() => void>();
function setShown(records: readonly ScreenRecord[]) {
  shown = records;
  for (const listener of listeners) listener();
}

/**
 * Publish the screen's records, the record it shows first and then the person's selection, while
 * the screen is mounted. A screen that unmounts clears only what it published, so the next
 * screen's records stay when its effect runs first.
 */
// #region publish
export function useScreenRecords(records: readonly ScreenRecord[]) {
  const key = JSON.stringify(records);
  useEffect(() => {
    const published = JSON.parse(key) as readonly ScreenRecord[];
    setShown(published);
    return () => {
      if (shown === published) setShown(none);
    };
  }, [key]);
}
// #endregion publish

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

/** Select one record on the current screen; true when the screen shows it and selected it. */
type Selector = (kind: string, id: string) => boolean;
let selector: { readonly current: Selector } | undefined;

/**
 * Let the assistant's `ui.select` reach this screen while it is mounted: `select` selects a record
 * of a kind the screen selects, such as a call on Inquiries, when the screen shows it now.
 */
export function useScreenSelection(select: Selector) {
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
 * Select `<kind>:<id>` on the current screen for the assistant's `ui.select`. A record the screen
 * already hands to the panel is selected as it is; otherwise the screen selects it, and throws, so
 * the intent is rejected, when it does not show that record.
 */
export function selectOnScreen(resource: string) {
  const at = resource.indexOf(':');
  const [kind, id] = [resource.slice(0, at), resource.slice(at + 1)];
  if (shown.some((record) => record.kind === kind && record.id === id)) return;
  if (!selector?.current(kind, id)) throw new Error(`This screen does not show ${resource}`);
}

/** The inquiry a screen was opened for, by its ID, such as the `inquiry` search parameter. */
export function useInquiry(id: string | undefined) {
  return useQuery({
    ...live.liveQueryOptions(operations.inquiryGet, { id: id ?? '' }),
    enabled: id !== undefined,
  }).data;
}
