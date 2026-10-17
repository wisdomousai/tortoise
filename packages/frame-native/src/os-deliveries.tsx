import { useEffect, useSyncExternalStore } from 'react';
import type { JsonObject, OsDelivery, OsProvenance } from '@agent-native/contracts';
import { nativeScreenForCapability, type NativeApplicationScreens } from './screens';
import { useSession, type NativeSession } from './session';

/** Where deliveries come from: the mobile host's OS connection, or a test's fake. */
export interface OsDeliverySource {
  subscribe(listener: (delivery: OsDelivery) => void): () => void;
}

/** A form prefill an OS request asked for, until the person submits or dismisses it. */
export interface PreparedInput {
  readonly id: string;
  readonly input: JsonObject;
  readonly provenance: OsProvenance;
}

const prepared = new Map<string, PreparedInput>();
let shown: { readonly id: string; readonly provenance: OsProvenance } | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * The prefill waiting for `operation`, if an OS request asked for one. A screen shows its
 * provenance, fills its fields from it and calls `dismiss` once committed or cancelled. Nothing
 * submits on its own.
 */
export function usePreparedInput(operation: string) {
  const value = useSyncExternalStore(subscribe, () => prepared.get(operation));
  return {
    prepared: value,
    dismiss() {
      if (prepared.get(operation) !== value) return;
      prepared.delete(operation);
      notify();
    },
  };
}

/** Where the last opened screen came from, until dismissed. */
export function useShownProvenance() {
  const value = useSyncExternalStore(subscribe, () => shown);
  return {
    shown: value,
    dismiss() {
      shown = undefined;
      notify();
    },
  };
}

export type OpenScreen = (to: string, params?: Record<string, unknown>) => void;

/**
 * Apply one delivery: hold a prefill and open the screen that binds its command, navigate to a
 * declared screen, or open the screen `screens.resources` resolves for a resource. A target
 * that no screen declares is dropped; nothing here commits.
 */
export async function applyOsDelivery(
  delivery: OsDelivery,
  screens: NativeApplicationScreens,
  session: NativeSession,
  open: OpenScreen,
) {
  const id = crypto.randomUUID();
  const known = new Set(screens.routes.map((route) => route.path));
  if (delivery.type === 'prepare') {
    prepared.set(delivery.operation, {
      id,
      input: delivery.input,
      provenance: delivery.provenance,
    });
    notify();
    const to = nativeScreenForCapability(screens, delivery.operation);
    if (to) open(to);
    return;
  }
  if (delivery.type === 'navigate') {
    if (!known.has(delivery.to)) throw new Error(`No screen ${delivery.to}`);
    open(delivery.to, delivery.search);
  } else {
    const [kind, ...rest] = delivery.resource.split(':');
    const resolve = kind ? screens.resources?.[kind] : undefined;
    if (!resolve) throw new Error(`No screen opens ${kind} resources`);
    const target = await resolve(rest.join(':'), session);
    if (!known.has(target.to)) throw new Error(`No screen ${target.to}`);
    open(target.to, target.params);
  }
  shown = { id, provenance: delivery.provenance };
  notify();
}

/**
 * Show what OS requests asked for. The frame mounts it once navigation is ready, so the source
 * replays what arrived during a cold start. A delivery the frame cannot show is dropped, because
 * the OS request behind it was unsolicited.
 */
export function OsDeliveries({
  source,
  screens,
  open,
}: {
  source: OsDeliverySource;
  screens: NativeApplicationScreens;
  open: OpenScreen;
}) {
  const session = useSession();
  useEffect(
    () =>
      source.subscribe(
        (delivery) => void applyOsDelivery(delivery, screens, session, open).catch(() => undefined),
      ),
    [source, screens, session, open],
  );
  return null;
}
