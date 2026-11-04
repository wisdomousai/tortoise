import { ListChecks } from 'lucide-react';
import { automationScreens } from '@tortoise/automation/plugin-screens';
import { defineScreens } from '@tortoise/frame/screens';
import { AssistantButton, AssistantPanel } from '@/components/assistant-panel';
import {
  requestCapabilityScreens,
  requestNavigation,
  requestRoutes,
} from '@tortoise/pattern-base/ui/requests';
import manifest from './manifest';
import { Approvals, MethodSuggestions } from './ui/methods';

/**
 * The base pattern's screens with method suggestions on the request screen, an approvals list,
 * the automation screen and the frame's assistant panel beside every screen. `resources` is where
 * an agent's open intent leads for each kind.
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
  aside: AssistantPanel,
  asideButton: AssistantButton,
});
