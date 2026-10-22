import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { JsonObject, OsDelivery, OsProvenance } from '@agent-native/contracts';
import {
  resourcePath,
  screenForCapability,
  type ApplicationScreens,
} from '@agent-native/frame/screens';
import { hostJson } from './host-client';

export { describeProvenance } from '@agent-native/shell/provenance';

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
  return () => listeners.delete(listener);
};

/**
 * The prefill waiting for `operation`, if an OS request asked for one. A form shows its
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

type Navigate = (path: string, search?: Readonly<Record<string, string>>) => Promise<void>;

/** Apply one delivery: open the resource's screen, navigate, or hold a prefill for its form. */
async function apply(id: string, delivery: OsDelivery, screens: ApplicationScreens, go: Navigate) {
  if (delivery.type === 'prepare') {
    const to = screenForCapability(screens, delivery.operation);
    prepared.set(delivery.operation, {
      id,
      input: delivery.input,
      provenance: delivery.provenance,
    });
    notify();
    if (to) await go(to);
    return;
  }
  if (delivery.type === 'navigate') await go(delivery.to, delivery.search);
  else await go(await resourcePath(screens, delivery.resource));
  shown = { id, provenance: delivery.provenance };
  notify();
}

/**
 * Take what OS requests from this session asked the frame to show, and acknowledge each. Mounted
 * once at the frame root, so it runs under every layout. It polls only while the page is
 * visible; the host keeps deliveries for two minutes, long enough for a cold start.
 */
export function useOsDeliveries(screens: ApplicationScreens) {
  const router = useRouter();
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const go: Navigate = (path, search) =>
      router.navigate({ to: path, search: search as never } as never);
    async function poll() {
      try {
        if (document.visibilityState === 'visible') {
          const items = await hostJson<{ id: string; delivery: OsDelivery }[]>(
            'ui/deliveries',
            undefined,
            abort.signal,
          );
          for (const item of items) {
            let status: 'accepted' | 'rejected' = 'accepted';
            try {
              await apply(item.id, item.delivery, screens, go);
            } catch {
              status = 'rejected';
            }
            await hostJson(`ui/deliveries/${item.id}/ack`, { status }, abort.signal);
          }
        }
      } catch {
        // A failed poll is retried; the host keeps the delivery until it expires.
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [router, screens]);
}
