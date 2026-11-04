import { defineHostPlugin } from '@tortoise/host/plugin';
import { startDelivery } from './delivery';
import { webhookPluginManifest } from './plugin-manifest';
import {
  createWebhookState,
  webhookHandlers,
  webhookPolicy,
  type WebhookServices,
  type WebhookState,
} from './server';

const operationsOf = (setting: string | undefined) =>
  (setting ?? '')
    .split(',')
    .map((operation) => operation.trim())
    .filter(Boolean);

/**
 * The webhook example plugin, written only against the public plugin API. Its slice records
 * delivery progress; a serving host with `webhook-operations` set runs the delivery loop. It
 * needs no other plugin: without one that binds `webhook-target`, the network port refuses
 * every post and the refusal shows up as `lastError`.
 */
export function createWebhookPlugin(options: { intervalMs?: number; now?: () => number } = {}) {
  return defineHostPlugin<WebhookState, WebhookServices>({
    manifest: webhookPluginManifest,
    state: { create: createWebhookState },
    handlers: webhookHandlers,
    authorization: { resourceTypes: ['webhook'], port: webhookPolicy },
    async open({ manifest, settings }) {
      const observing = operationsOf(settings['webhook-operations']);
      const known = new Set(
        manifest.modules.flatMap((module) => module.capabilities.map((c) => c.id)),
      );
      const unknown = observing.filter((operation) => !known.has(operation));
      if (unknown.length)
        throw new Error(`webhook-operations names unknown operations: ${unknown.join(', ')}`);
      return {
        service: { observing, ...(options.now ? { now: options.now } : {}) },
        start: async (context) =>
          observing.length ? [await startDelivery(context, observing, options.intervalMs)] : [],
        describe: () => ({ observing }),
      };
    },
  });
}

export const webhookPlugin = createWebhookPlugin();
