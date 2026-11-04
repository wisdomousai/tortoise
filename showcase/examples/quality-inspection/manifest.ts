import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { driverPluginManifest } from '@tortoise/connector-driver/plugin-manifest';
import { peerLinkPluginManifest } from '@tortoise/peer-link/plugin-manifest';
import { qualityInspectionModule } from './contracts';
import { instrumentContract } from './contracts/instrument';

/** Browser-safe identity of the quality-inspection application. */
export default defineManifest({
  id: 'quality-inspection',
  title: 'Quality inspection',
  modules: [qualityInspectionModule],
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    processPluginManifest,
    driverPluginManifest([instrumentContract]),
    peerLinkPluginManifest,
  ],
});
