import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/sample-lab-requests/ui/requests';
import manifest from './manifest';
import { ResultsSection } from './ui/results';

/** The base sample's screens, with test results and the sandboxed analysis on the request screen. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes({ sections: [ResultsSection] }),
  navigation: requestNavigation,
  capabilityScreens: [...requestCapabilityScreens, { prefix: 'test-result.', to: '/requests' }],
});
