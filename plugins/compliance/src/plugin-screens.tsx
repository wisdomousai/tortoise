import { ShieldCheck } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { ComplianceScreen } from './components/compliance-screen';

/**
 * The compliance plugin's screen: the Compliance screen at `/compliance`, a sidebar entry, and
 * the palette target for `compliance.*`. The screen is built from the starter's stock primitives
 * (`@/components/ui/*`) and the frame's session, and also ships as this plugin's registry item.
 */
export const complianceScreens = definePluginScreens({
  id: 'compliance',
  routes: [{ path: 'compliance', component: ComplianceScreen }],
  navigation: [{ to: '/compliance', label: 'Compliance', icon: ShieldCheck }],
  capabilityScreens: [{ prefix: 'compliance.', to: '/compliance' }],
});
