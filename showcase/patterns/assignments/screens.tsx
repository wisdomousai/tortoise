import { peerLinkScreens } from '@tortoise/peer-link/plugin-screens';
import { defineScreens } from '@tortoise/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@tortoise/pattern-base/ui/requests';
import manifest from './manifest';
import { roundCapabilityScreens, roundNavigation, roundRoutes } from './ui/rounds';

/**
 * The base pattern's screens, the round board and reports, my rounds, and the peer screens.
 * `resources` is where an open intent leads for each kind.
 */
export default defineScreens({
  title: manifest.title,
  home: '/rounds',
  routes: [...requestRoutes(), ...roundRoutes],
  navigation: [...requestNavigation, ...roundNavigation],
  capabilityScreens: [...requestCapabilityScreens, ...roundCapabilityScreens],
  resources: {
    'test-request': (id) => `/requests/${id}`,
    assignment: (id) => `/rounds/${id}`,
    'assignment-report': (id) => `/reports/${id}`,
  },
  manifest,
  plugins: [peerLinkScreens],
});
