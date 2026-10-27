import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/pattern-base/ui/requests';
import manifest from './manifest';

/** The base pattern's screens, unchanged. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes(),
  navigation: requestNavigation,
  capabilityScreens: requestCapabilityScreens,
});
