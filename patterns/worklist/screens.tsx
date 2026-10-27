import { peerLinkScreens } from '@agent-native/peer-link/plugin-screens';
import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/pattern-base/ui/requests';
import manifest from './manifest';
import { roundCapabilityScreens, roundNavigation, roundRoutes } from './ui/rounds';

/** The base pattern's screens, the sampling rounds held here, and the peers screen to connect. */
export default defineScreens({
  title: manifest.title,
  home: '/rounds',
  routes: [...requestRoutes(), ...roundRoutes],
  navigation: [...requestNavigation, ...roundNavigation],
  capabilityScreens: [...requestCapabilityScreens, ...roundCapabilityScreens],
  resources: {
    'test-request': (id) => `/requests/${id}`,
    'worklist-assignment': (id) => `/rounds/${id}`,
  },
  manifest,
  plugins: [peerLinkScreens],
});
