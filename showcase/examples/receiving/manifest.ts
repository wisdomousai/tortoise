import { approvalFeatureManifest, reconciliationFeatureManifest } from '@agent-native/contracts';
import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { peerLinkPluginManifest } from '@agent-native/peer-link/plugin-manifest';
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
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
    peerLinkPluginManifest,
  ],
});
