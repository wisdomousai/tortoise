import { approvalFeatureManifest, defineHostComponent } from '@agent-native/contracts';
import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { driverPluginManifest } from '@agent-native/connector-driver/plugin-manifest';
import { deviceFeatureManifest } from '@agent-native/devices/contracts';
import { scannerDevicesComponent } from '@agent-native/devices/requirements';
import { stationBridgeComponent } from '@agent-native/screen-bridge/requirements';
import { windingLineModule, stopExplainerModule } from './contracts';
import { stationAutomationContract } from './contracts/automation';

/** The browser this application's screen bridge controls to reach a web-based station HMI. */
export const stationBrowserComponent = defineHostComponent({
  id: 'station-browser',
  description: 'Browser for the winding-line screen bridge.',
  requirements: {
    processes: [
      {
        id: 'station-bridge-browser',
        executable: 'chromium (Playwright)',
        purpose: 'Browser that reaches a web-based station HMI for the screen bridge.',
        availability: 'optional',
        network: ['station-screen'],
      },
    ],
  },
});

/**
 * Browser-safe identity of the winding-line application: stations and the stop explainer, with
 * the approval and device features, the screen bridge, its browser and the scanner sources as
 * declared components, and the station automation driver for a station reached through its
 * automation interface.
 */
export default defineManifest({
  id: 'winding-line',
  title: 'Transformer coil winding',
  modules: [windingLineModule, stopExplainerModule],
  features: [approvalFeatureManifest, deviceFeatureManifest],
  components: [stationBridgeComponent, stationBrowserComponent, scannerDevicesComponent],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    processPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    automationPluginManifest,
    driverPluginManifest([stationAutomationContract]),
  ],
});
