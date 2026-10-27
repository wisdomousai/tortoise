import { defineManifest } from '@agent-native/host/manifest';
import { labRequestsModule } from '@agent-native/sample-lab-requests/contracts';
import { reviewFeatureManifest } from './features/review/contracts';

/** Browser-safe identity of the review sample: the lab requests module and the review feature. */
export default defineManifest({
  id: 'lab-requests-review',
  title: 'Lab request review',
  modules: [labRequestsModule],
  features: [reviewFeatureManifest],
});
