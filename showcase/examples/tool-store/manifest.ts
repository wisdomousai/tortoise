import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { stationSignInPluginManifest } from '@tortoise/workstation-sign-in/plugin-manifest';
import { toolStoreModule } from './contracts';
import { handoverFeatureManifest } from './features/handover/contracts';
import { deviceFeatureManifest } from '@tortoise/devices/contracts';
import { approvalFeatureManifest, reconciliationFeatureManifest } from '@tortoise/contracts';
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
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    // Attendants sign in at the counter terminal with badge and PIN.
    stationSignInPluginManifest,
  ],
});
