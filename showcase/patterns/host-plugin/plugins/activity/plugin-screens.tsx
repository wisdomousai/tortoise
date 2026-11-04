import { Activity } from 'lucide-react';
import { definePluginScreens } from '@tortoise/frame/plugin-screens';
import { ActivityScreen } from './ui/summary';

/** The activity plugin's summary screen, sidebar entry and palette target for `activity.*`. */
export const activityScreens = definePluginScreens({
  id: 'activity',
  routes: [{ path: 'activity', component: ActivityScreen }],
  navigation: [{ to: '/activity', label: 'Activity', icon: Activity }],
  capabilityScreens: [{ prefix: 'activity.', to: '/activity' }],
});
