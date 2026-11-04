import { defineScreens } from '@tortoise/frame/screens';
import manifest from './manifest';
import { requestCapabilityScreens, requestNavigation, requestRoutes } from './ui/requests';

/** The test requests screens: the test request list and one test request. */
export default defineScreens({
  title: manifest.title,
  home: '/requests',
  routes: requestRoutes(),
  navigation: requestNavigation,
  capabilityScreens: requestCapabilityScreens,
});
