import { defineScreens } from '@agent-native/frame/screens';
import manifest from './manifest';
import { noteCapabilityScreens, noteNavigation, noteRoutes } from './ui/notes';

/** The Notes screens: the note list and one note. */
export default defineScreens({
  title: manifest.title,
  home: '/notes',
  routes: noteRoutes(),
  navigation: noteNavigation,
  capabilityScreens: noteCapabilityScreens,
});
