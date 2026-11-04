import { defineManifest } from '@tortoise/host/manifest';
import { testRequestsModule } from './contracts';

/** Browser-safe identity of the base pattern. It composes no plugins. */
export default defineManifest({
  id: 'test-requests',
  title: 'Oil test requests',
  modules: [testRequestsModule],
});
