import { defineManifest } from '@agent-native/host/manifest';
import { testRequestsModule } from '@agent-native/pattern-base/contracts';
import { reviewFeatureManifest } from './features/review/contracts';

/** Browser-safe identity of the review pattern: the test requests module and the review feature. */
export default defineManifest({
  id: 'test-requests-review',
  title: 'Lab request review',
  modules: [testRequestsModule],
  features: [reviewFeatureManifest],
});
