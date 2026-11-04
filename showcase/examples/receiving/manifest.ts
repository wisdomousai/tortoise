import { approvalFeatureManifest, reconciliationFeatureManifest } from '@tortoise/contracts';
import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { compliancePluginManifest } from '@tortoise/compliance/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { peerLinkPluginManifest } from '@tortoise/peer-link/plugin-manifest';
import { receivingModule } from './contracts';
import { erpExchange } from './contracts/erp-target';
import { qualityPeer } from './contracts/quality-peer';

/** Browser-safe identity of the Goods receiving application. */
export default defineManifest({
  id: 'receiving',
  title: 'Goods receiving',
  modules: [receivingModule],
  components: [erpExchange, qualityPeer.component],
  features: [approvalFeatureManifest, reconciliationFeatureManifest],
  plugins: [
    deploymentPluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    peerLinkPluginManifest,
  ],
});
