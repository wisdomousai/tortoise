import { ListChecks } from 'lucide-react';
import { automationScreens } from '@agent-native/automation/plugin-screens';
import { defineScreens } from '@agent-native/frame/screens';
import {
  noteCapabilityScreens,
  noteNavigation,
  noteRoutes,
} from '@agent-native/sample-notes/ui/notes';
import manifest from './manifest';
import { Approvals, TitleSuggestions } from './ui/titles';

/**
 * The base sample's screens with title suggestions on the note screen, an approvals list and the
 * automation screen. `resources` is where an agent's open intent leads for each kind.
 */
export default defineScreens({
  title: manifest.title,
  home: '/notes',
  routes: [
    ...noteRoutes({ sections: [TitleSuggestions] }),
    { path: 'approvals', component: Approvals },
  ],
  navigation: [...noteNavigation, { to: '/approvals', label: 'Approvals', icon: ListChecks }],
  capabilityScreens: [...noteCapabilityScreens, { prefix: 'approval.', to: '/approvals' }],
  resources: { note: (id) => `/notes/${id}`, 'approval-request': () => '/approvals' },
  plugins: [automationScreens],
});
