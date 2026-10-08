import { Webhook } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { WebhookScreen } from './ui/status';

/** The webhook plugin's status screen, sidebar entry and palette target for `webhook.*`. */
export const webhookScreens = definePluginScreens({
  id: 'webhook',
  routes: [{ path: 'webhook', component: WebhookScreen }],
  navigation: [{ to: '/webhook', label: 'Webhook', icon: Webhook }],
  capabilityScreens: [{ prefix: 'webhook.', to: '/webhook' }],
});
