import { defineManifest } from '@tortoise/host/manifest';
import { testRequestsModule } from '@tortoise/pattern-base/contracts';
import { reviewFeatureManifest } from './features/review/contracts';

/** Browser-safe identity of the review pattern: the test requests module and the review feature. */
export default defineManifest({
  id: 'test-requests-review',
  title: 'Lab request review',
  modules: [testRequestsModule],
  features: [reviewFeatureManifest],
});
