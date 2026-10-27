import { Send } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/sample-lab-requests/ui/requests';
import manifest from './manifest';
import { PublishSection, Publications } from './ui/publishing';

/** The base sample's screens with publishing on the test request screen and a publications list. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: [
    ...requestRoutes({ sections: [PublishSection] }),
    { path: 'publications', component: Publications },
  ],
  navigation: [...requestNavigation, { to: '/publications', label: 'Publications', icon: Send }],
  capabilityScreens: [
    ...requestCapabilityScreens,
    { prefix: 'publication.', to: '/publications' },
    { prefix: 'reconciliation.', to: '/publications' },
  ],
});
