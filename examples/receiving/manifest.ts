import { defineManifest } from '@agent-native/host/manifest';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { compliancePluginManifest } from '@agent-native/compliance/plugin-manifest';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { receivingModule } from './contracts';
import { erpExchange } from './contracts/erp-target';

/** Browser-safe identity of the Goods receiving application. */
export default defineManifest({
  id: 'receiving',
  title: 'Goods receiving',
  modules: [receivingModule],
  components: [erpExchange],
  plugins: [
    sitePluginManifest,
    networkPluginManifest,
    auditPluginManifest,
    compliancePluginManifest,
  ],
});
