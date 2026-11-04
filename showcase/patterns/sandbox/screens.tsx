import { defineScreens } from '@tortoise/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@tortoise/pattern-base/ui/requests';
import manifest from './manifest';
import { ResultsSection } from './ui/results';

/** The base pattern's screens, with test results and the sandboxed analysis on the request screen. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes({ sections: [ResultsSection] }),
  navigation: requestNavigation,
  capabilityScreens: [...requestCapabilityScreens, { prefix: 'test-result.', to: '/requests' }],
});
