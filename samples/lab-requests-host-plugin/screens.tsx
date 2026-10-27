import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/sample-lab-requests/ui/requests';
import manifest from './manifest';
import { activityScreens } from './plugins/activity/plugin-screens';

/** The base sample's screens and the activity plugin's summary screen. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes(),
  navigation: requestNavigation,
  capabilityScreens: requestCapabilityScreens,
  plugins: [activityScreens],
});
