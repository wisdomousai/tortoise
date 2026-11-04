import { List } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import manifest from './manifest';
// scaffold:imports

/** The {{displayName}} screens. Each collection starts with the default list and record screens. */
export default defineScreens({
  manifest,
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
  features: [
    // scaffold:features
  ],
  plugins: [complianceScreens],
});
