import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { stationSignInPluginManifest } from '@agent-native/workstation-sign-in/plugin-manifest';
import { toolStoreModule } from './contracts';
import { handoverFeatureManifest } from './features/handover/contracts';
import { deviceFeatureManifest } from '@agent-native/devices/contracts';
import { approvalFeatureManifest, reconciliationFeatureManifest } from '@agent-native/contracts';
import { assignments } from './contracts/assignments';
// scaffold:imports

/** Browser-safe identity of the Tool Store application. */
export default defineManifest({
  id: 'tool-store',
  title: 'Tool Store',
  // Each build is best before its build date plus this many days; nothing is refused after it.
  shelfLifeDays: 180,
  modules: [toolStoreModule],
  features: [
    handoverFeatureManifest,
    deviceFeatureManifest,
    // Held EAM deliveries, which a person decides on the EAM screen.
    reconciliationFeatureManifest,
    // Requests to retire a tool, which an attendant decides on the Approvals screen.
    approvalFeatureManifest,
    assignments.manifest,
    // scaffold:features
  ],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    // Attendants sign in at the counter terminal with badge and PIN.
    stationSignInPluginManifest,
  ],
});
