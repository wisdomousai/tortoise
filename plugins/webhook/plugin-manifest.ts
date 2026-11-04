import { defineHostComponent } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import { webhookModule } from './contracts';

/** The one destination this plugin may reach. A deployment policy binds it to an address. */
export const webhookDeliveryComponent = defineHostComponent({
  id: 'webhook-delivery',
  description: 'Posts change notifications to the configured webhook.',
  requirements: {
    network: [
      {
        id: 'webhook-target',
        purpose: 'Notify a downstream system that observed resources changed.',
        direction: 'egress',
        scope: 'local',
        protocol: 'https',
        dataClasses: ['change-notification'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
});

/**
 * The browser-safe part of the webhook example plugin. It brings its own module, its own
 * declared destination and one setting; it reaches the network only through the host's network
 * port, so without a plugin that binds `webhook-target` every delivery is refused and recorded.
 */
export const webhookPluginManifest = definePluginManifest({
  id: 'webhook',
  title: 'Webhook',
  modules: [webhookModule],
  components: [webhookDeliveryComponent],
  settings: [
    {
      key: 'webhook-operations',
      env: 'TORTOISE_WEBHOOK_OPERATIONS',
      kind: 'string',
      description: 'comma-separated operations whose changes are posted; absent: inactive',
    },
  ],
});
