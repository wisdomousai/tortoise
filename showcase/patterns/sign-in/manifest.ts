import { defineManifest } from '@tortoise/host/manifest';
import { stationSignInPluginManifest } from '@tortoise/workstation-sign-in/plugin-manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';

/** The test requests module and workstation sign-in at the bench. Browser-safe. */
export default defineManifest({
  id: 'test-requests-sign-in',
  title: 'Lab bench sign-in',
  modules: [testRequestsModule],
  plugins: [stationSignInPluginManifest],
});
