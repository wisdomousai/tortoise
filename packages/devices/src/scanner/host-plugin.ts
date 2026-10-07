import { decodeScan } from './decode';
import type { ScannerProfile } from './profile';
import { ScannerUnsupported, type ScannerSource } from './source';
import type { Symbology } from './symbology';

/**
 * Narrow bridge for scanners that need a vendor SDK or OS driver in the host process (for example
 * a desktop app's main process). The host owns the device; the renderer only receives decoded
 * text through this subscription. Expose it from a preload script; never expose the SDK itself.
 */
export interface HostScannerBridge {
  subscribe(
    profileId: string,
    listener: (scan: {
      readonly text: string;
      readonly symbology?: Symbology;
      readonly deviceId?: string;
    }) => void,
  ): () => void;
}

export function createHostPluginSource(
  profile: ScannerProfile,
  bridge: HostScannerBridge | undefined,
): ScannerSource {
  return {
    transport: 'host-plugin',
    profile,
    isSupported: () => bridge !== undefined,
    async start({ onScan }) {
      if (!bridge) throw new ScannerUnsupported('host-plugin', 'no host scanner bridge');
      return bridge.subscribe(profile.id, (scan) =>
        onScan(
          decodeScan(scan.text, profile, {
            at: performance.now(),
            ...(scan.symbology ? { symbology: scan.symbology } : {}),
            ...(scan.deviceId ? { deviceId: scan.deviceId } : {}),
          }),
        ),
      );
    },
  };
}

/** In-process bridge for tests and demos; `emit` stands in for the vendor SDK callback. */
export function createFakeHostBridge() {
  const listeners = new Map<string, Set<Parameters<HostScannerBridge['subscribe']>[1]>>();
  const bridge: HostScannerBridge = {
    subscribe(profileId, listener) {
      const set = listeners.get(profileId) ?? new Set();
      set.add(listener);
      listeners.set(profileId, set);
      return () => set.delete(listener);
    },
  };
  return {
    bridge,
    emit(profileId: string, text: string, symbology?: Symbology) {
      for (const listener of listeners.get(profileId) ?? [])
        listener({ text, ...(symbology ? { symbology } : {}) });
    },
  };
}
