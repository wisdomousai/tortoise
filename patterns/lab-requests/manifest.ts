import { defineManifest } from '@agent-native/host/manifest';
import { labRequestsModule } from './contracts';

/** Browser-safe identity of the lab requests pattern. It composes no plugins. */
export default defineManifest({
  id: 'lab-requests',
  title: 'Lab requests',
  modules: [labRequestsModule],
});
