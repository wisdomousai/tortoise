import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { driverPluginManifest } from '@agent-native/connector-driver/plugin-manifest';
import { peerLinkPluginManifest } from '@agent-native/peer-link/plugin-manifest';
import { qualityInspectionModule } from './contracts';
import { instrumentContract } from './contracts/instrument';

/** Browser-safe identity of the quality-inspection application. */
export default defineManifest({
  id: 'quality-inspection',
  title: 'Quality inspection',
  modules: [qualityInspectionModule],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    processPluginManifest,
    driverPluginManifest([instrumentContract]),
    peerLinkPluginManifest,
  ],
});
