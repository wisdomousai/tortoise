import { defineHostComponent } from '@agent-native/contracts';
import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { deviceConfigModule } from '@agent-native/devices/contracts';
import { scannerDevicesComponent } from '@agent-native/devices/requirements';
import { stationBridgeComponent } from '@agent-native/station/requirements';
import { lineStationModule } from './contracts';

/** The browser this application's screen bridge drives to reach a web-based station HMI. */
export const stationBrowserComponent = defineHostComponent({
  id: 'station-browser',
  description: 'Browser for the line-station screen bridge.',
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
 * Browser-safe identity of the line-station application: stations plus device configuration,
 * with the screen bridge, its browser and the scanner sources as declared components.
 */
export default defineManifest({
  id: 'line-station',
  title: 'Line stations',
  modules: [lineStationModule, deviceConfigModule],
  components: [stationBridgeComponent, stationBrowserComponent, scannerDevicesComponent],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
  ],
});
