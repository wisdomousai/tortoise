import { defineManifest } from '@agent-native/host/manifest';
import { testRequestsModule } from './contracts';

/** Browser-safe identity of the base pattern. It composes no plugins. */
export default defineManifest({
  id: 'test-requests',
  title: 'Oil test requests',
  modules: [testRequestsModule],
});
