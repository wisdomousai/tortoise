import { Send } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';
import { PublishSection, Publications } from './ui/publishing';

/** The base sample's screens with publishing on the note screen and a publications list. */
export default defineScreens({
  title: manifest.title,
  home: '/notes',
  routes: [
    ...noteRoutes({ sections: [PublishSection] }),
    { path: 'publications', component: Publications },
  ],
  navigation: [...noteNavigation, { to: '/publications', label: 'Publications', icon: Send }],
  capabilityScreens: [
    ...noteCapabilityScreens,
    { prefix: 'publication.', to: '/publications' },
    { prefix: 'reconciliation.', to: '/publications' },
  ],
});
