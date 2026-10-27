import { defineManifest } from '@agent-native/host/manifest';
import { stationSignInPluginManifest } from '@agent-native/workstation-sign-in/plugin-manifest';
import { labRequestsModule } from '@agent-native/pattern-lab-requests/contracts';

/** The lab requests module and workstation sign-in at the bench. Browser-safe. */
export default defineManifest({
  id: 'lab-requests-sign-in',
  title: 'Lab bench sign-in',
  modules: [labRequestsModule],
  plugins: [stationSignInPluginManifest],
});
