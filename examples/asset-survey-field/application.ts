import { Platform } from 'react-native';
import { intentScannerPlugin } from '@agent-native/intent-scanner/plugin';
import { managedConfigPlugin } from '@agent-native/managed-config/plugin';
import { createFieldApplication } from './field-application';

/**
 * The field app as the device runs it. Managed configuration can hand it the hub address and an
 * enrollment code; the intent scanner exists only on Android, so an iOS build leaves it out and
 * its manifest does not list it.
 */
export default createFieldApplication({
  plugins:
    Platform.OS === 'android' ? [managedConfigPlugin, intentScannerPlugin] : [managedConfigPlugin],
});
