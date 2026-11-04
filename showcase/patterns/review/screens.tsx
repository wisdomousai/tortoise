import { defineScreens } from '@tortoise/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@tortoise/pattern-base/ui/requests';
import manifest from './manifest';
import { reviewScreens } from './features/review/screens';
import { RequestReview } from './ui/request-review';

/** The test request screens, with the review panel below each test request. */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes({ sections: [RequestReview] }),
  navigation: requestNavigation,
  capabilityScreens: requestCapabilityScreens,
  features: [reviewScreens({ open: '/requests' })],
});
