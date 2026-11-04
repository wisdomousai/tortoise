import { defineManifest } from '@tortoise/host/manifest';
import { peerLinkPluginManifest } from '@tortoise/peer-link/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { assignments, samplingModule } from './contracts';

/**
 * The test requests module, the sampling module, the assignment feature and the peer link.
 * Browser-safe.
 */
export default defineManifest({
  id: 'test-requests-assignments',
  title: 'Oil test requests with sampling rounds',
  modules: [testRequestsModule, samplingModule],
  features: [assignments.manifest],
  plugins: [peerLinkPluginManifest],
});
