import { decodeScan } from '@agent-native/devices/scanner/decode';
import type { ScannerProfile } from '@agent-native/devices/scanner/profile';
import { ScannerUnsupported, type ScannerSource } from '@agent-native/devices/scanner/source';

/** The native module's calls, as `AgentNativeIntentScanner` exposes them on Android. */
export interface IntentScannerModule {
  listen(action: string, dataExtra: string, senderPermission: string | null): void;
  stop(action: string): void;
  addListener(
    event: 'onScan',
    listener: (scan: { readonly action: string; readonly text: string }) => void,
  ): { remove(): void };
}

/**
 * A scanner source for a profile with `transport: 'intent'`: each broadcast for the profile's
 * action becomes one decoded scan, through the same `decodeScan` as every other source, so
 * prefixes, AIM identifiers and GS1 parsing follow the profile. `module` is `null` where the
 * native receiver is missing (iOS, a build without the plugin); the source then reports itself
 * unsupported. Stopping the last listener of an action unregisters the receiver.
 */
export function createIntentSource(
  profile: ScannerProfile,
  module: IntentScannerModule | null,
): ScannerSource {
  return {
    transport: 'intent',
    profile,
    isSupported: () => module !== null && profile.intent !== undefined,
    async start({ onScan }) {
      if (!module) throw new ScannerUnsupported('intent', 'no native intent receiver');
      const intent = profile.intent;
      if (!intent) throw new ScannerUnsupported('intent', `profile "${profile.id}" has no intent`);
      const subscription = module.addListener('onScan', (scan) => {
        if (scan.action !== intent.action) return;
        onScan(decodeScan(scan.text, profile, { at: performance.now() }));
      });
      module.listen(intent.action, intent.dataExtra, intent.senderPermission ?? null);
      return () => {
        subscription.remove();
        module.stop(intent.action);
      };
    },
  };
}
