import { ShieldCheck } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { SecurityScreen } from './components/security-screen';

/**
 * The assurance plugin's screen: its Security screen at `/security`, a sidebar entry, and the
 * palette target for `assurance.*`. The screen is built from the starter's stock primitives
 * (`@/components/ui/*`) and the frame's session, and also ships as this plugin's registry item.
 */
export const assuranceScreens = definePluginScreens({
  id: 'assurance',
  routes: [{ path: 'security', component: SecurityScreen }],
  navigation: [{ to: '/security', label: 'Security', icon: ShieldCheck }],
  capabilityScreens: [{ prefix: 'assurance.', to: '/security' }],
});
