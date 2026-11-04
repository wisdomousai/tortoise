import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ScannerProfile } from '@tortoise/devices/scanner/profile';
import { createIntentSource, type IntentScannerModule } from '../source';

/** The intent source on this device, bound to the native receiver when the build has it. */
export function intentSource(profile: ScannerProfile) {
  return createIntentSource(
    profile,
    requireOptionalNativeModule<IntentScannerModule>('AgentNativeIntentScanner'),
  );
}
