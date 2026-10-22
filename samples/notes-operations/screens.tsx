import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';

/** The base sample's screens, unchanged. */
export default defineScreens({
  title: manifest.title,
  home: '/notes',
  routes: noteRoutes(),
  navigation: noteNavigation,
  capabilityScreens: noteCapabilityScreens,
});
