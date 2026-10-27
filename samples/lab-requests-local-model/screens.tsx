import { ListChecks } from 'lucide-react';
import { automationScreens } from '@agent-native/automation/plugin-screens';
import { defineScreens } from '@agent-native/frame/screens';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@agent-native/sample-lab-requests/ui/requests';
import manifest from './manifest';
import { Approvals, MethodSuggestions } from './ui/suggestions';

/**
 * The base sample's screens with suggested methods on the request screen, an approvals list and
 * the automation screen, where a technician enables the trigger.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/requests',
  routes: [
    ...requestRoutes({ sections: [MethodSuggestions] }),
    { path: 'approvals', component: Approvals },
  ],
  navigation: [...requestNavigation, { to: '/approvals', label: 'Approvals', icon: ListChecks }],
  capabilityScreens: [...requestCapabilityScreens, { prefix: 'approval.', to: '/approvals' }],
  resources: {
    'test-request': (id) => `/requests/${id}`,
    'approval-request': () => '/approvals',
  },
  plugins: [automationScreens],
});
