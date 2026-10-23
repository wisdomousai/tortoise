import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';
import { activityScreens } from './plugins/activity/plugin-screens';

/** The base sample's screens and the activity plugin's summary screen. */
export default defineScreens({
  title: manifest.title,
  home: '/notes',
  routes: noteRoutes(),
  navigation: noteNavigation,
  capabilityScreens: noteCapabilityScreens,
  plugins: [activityScreens],
});
