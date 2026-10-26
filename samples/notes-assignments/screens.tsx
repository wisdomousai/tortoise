import { automationScreens } from '@agent-native/automation/plugin-screens';
import { peerLinkScreens } from '@agent-native/peer-link/plugin-screens';
import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';
import { reviewCapabilityScreens, reviewNavigation, reviewRoutes } from './ui/reviews';

/**
 * The base sample's screens, the review board and reports, my reviews, and the automation and
 * peer screens. `resources` is where an agent's open intent leads for each kind.
 */
export default defineScreens({
  title: manifest.title,
  home: '/reviews',
  routes: [...noteRoutes(), ...reviewRoutes],
  navigation: [...noteNavigation, ...reviewNavigation],
  capabilityScreens: [...noteCapabilityScreens, ...reviewCapabilityScreens],
  resources: {
    note: (id) => `/notes/${id}`,
    assignment: (id) => `/reviews/${id}`,
    'assignment-report': (id) => `/reports/${id}`,
  },
  manifest,
  plugins: [automationScreens, peerLinkScreens],
});
