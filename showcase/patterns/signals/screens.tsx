import { Thermometer } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@tortoise/pattern-base/ui/requests';
import manifest from './manifest';
import { ChambersScreen, RequestChamber } from './ui/chambers';

/** The base pattern's screens with conditioning on each test request and a chamber list. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: [
    ...requestRoutes({ sections: [RequestChamber] }),
    { path: 'chambers', component: ChambersScreen },
  ],
  navigation: [
    ...requestNavigation,
    { to: '/chambers', label: 'Climate chambers', icon: Thermometer },
  ],
  capabilityScreens: [...requestCapabilityScreens, { prefix: 'chamber.', to: '/chambers' }],
});
