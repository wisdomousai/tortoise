import { defineManifest } from '@tortoise/host/manifest';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { publishingModule } from './contracts';

/**
 * The test requests module and publishing, with the plugins that bind and guard the LIMS's
 * destination. Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-system-of-record',
  title: 'Lab request publishing',
  modules: [testRequestsModule, publishingModule],
  plugins: [deploymentPluginManifest, networkPluginManifest, auditPluginManifest],
});
