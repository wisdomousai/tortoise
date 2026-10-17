import { List } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import manifest from './manifest';
// scaffold:imports

/** The {{displayName}} screens. Each collection starts with the default list and record screens. */
export default defineScreens({
  title: manifest.title,
  home: '{{home}}',
  routes: [
    // scaffold:routes
  ],
  navigation: [
    // scaffold:navigation
  ],
  capabilityScreens: [
    // scaffold:capability-screens
  ],
  plugins: [complianceScreens],
});
