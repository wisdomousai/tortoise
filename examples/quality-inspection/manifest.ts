import { defineManifest } from '@agent-native/host/manifest';
import { qualityInspectionModule } from './contracts';

/** Browser-safe identity of the quality-inspection application. */
export default defineManifest({
  id: 'quality-inspection',
  title: 'Quality inspection',
  modules: [qualityInspectionModule],
});
