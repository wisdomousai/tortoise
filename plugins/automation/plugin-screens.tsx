import { Timer } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { AutomationScreen } from './ui/automation';

/** The automation screen, its sidebar entry and the palette target for `automation.*`. */
export const automationScreens = definePluginScreens({
  id: 'automation',
  routes: [{ path: 'automation', component: AutomationScreen }],
  navigation: [{ to: '/automation', label: 'Automation', icon: Timer }],
  capabilityScreens: [{ prefix: 'automation.', to: '/automation' }],
});
