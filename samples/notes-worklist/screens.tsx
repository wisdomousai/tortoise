import { peerLinkScreens } from '@agent-native/peer-link/plugin-screens';
import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';
import { reviewCapabilityScreens, reviewNavigation, reviewRoutes } from './ui/reviews';

/** The base sample's screens, the reviews held here, and the peers screen to connect. */
export default defineScreens({
  title: manifest.title,
  home: '/reviews',
  routes: [...noteRoutes(), ...reviewRoutes],
  navigation: [...noteNavigation, ...reviewNavigation],
  capabilityScreens: [...noteCapabilityScreens, ...reviewCapabilityScreens],
  resources: { note: (id) => `/notes/${id}`, 'worklist-assignment': (id) => `/reviews/${id}` },
  manifest,
  plugins: [peerLinkScreens],
});
