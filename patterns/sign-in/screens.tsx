import { defineScreens } from '@agent-native/frame/screens';
import { stationSignInScreens } from '@agent-native/workstation-sign-in/plugin-screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/pattern-base/ui/requests';
import manifest from './manifest';
import { BenchWork } from './ui/bench';

/**
 * The base pattern's screens, the seat for bench 2, where operators sign in with a badge
 * (LAB- and four digits) and a PIN and then work on `BenchWork`, and the badge screen.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/seat',
  routes: requestRoutes(),
  navigation: requestNavigation,
  capabilityScreens: requestCapabilityScreens,
  resources: { 'test-request': (id) => `/requests/${id}` },
  plugins: [
    stationSignInScreens({ seat: 'bench-2', work: BenchWork, badgePattern: '^(LAB-\\d{4})$' }),
  ],
});
