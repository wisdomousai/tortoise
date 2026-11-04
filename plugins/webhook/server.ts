import type { InputOf, OutputOf } from '@tortoise/contracts';
import type { AuthorizationPort, HandlerContribution } from '@tortoise/runtime';
import { webhookModule, webhookOperations } from './contracts';

/** Delivery progress and who may read and record it, under `state.webhook`. */
export interface WebhookState {
  readers: string[];
  cursor: number;
  delivered: number;
  failures: number;
  lastDeliveredAt?: number;
  lastError?: string;
}
export const createWebhookState = (localUserId: string): WebhookState => ({
  readers: [localUserId],
  cursor: 0,
  delivered: 0,
  failures: 0,
});

/** The plugin's service: what the launcher configured. */
export interface WebhookService {
  readonly observing: readonly string[];
  readonly now?: () => number;
}
export interface WebhookServices {
  readonly webhook?: WebhookService;
}

const statusOf = (state: WebhookState) => ({
  cursor: state.cursor,
  delivered: state.delivered,
  failures: state.failures,
  ...(state.lastDeliveredAt === undefined ? {} : { lastDeliveredAt: state.lastDeliveredAt }),
  ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
});

type Status = OutputOf<typeof webhookOperations.statusGet>;
type DeliveryRecord = InputOf<typeof webhookOperations.deliveryRecord>;

export const webhookHandlers: HandlerContribution<WebhookState, WebhookServices>[] = [
  {
    capability: webhookOperations.statusGet,
    handle: async (_input, ctx): Promise<Status> => ({
      ...statusOf(ctx.state),
      observing: [...(ctx.services.webhook?.observing ?? [])],
    }),
  },
  {
    capability: webhookOperations.deliveryRecord,
    handle: async (input, ctx) => {
      const record = input as DeliveryRecord;
      const state = ctx.state;
      if (record.error !== undefined) {
        state.failures++;
        state.lastError = record.error;
      } else {
        state.delivered += record.delivered;
        state.lastDeliveredAt = (ctx.services.webhook?.now ?? Date.now)();
        delete state.lastError;
      }
      if (record.cursor !== undefined) state.cursor = Math.max(state.cursor, record.cursor);
      ctx.change('webhook:delivery');
      return statusOf(state);
    },
  },
];

const known = new Set<string>(webhookModule.capabilities.map((capability) => capability.id));

/**
 * Listed readers read the status and record deliveries. The record command is for the delivery
 * loop, which acts as the local user narrowed to a grant; a delegated grant must list it.
 * Delivery events are not disclosed: nothing needs to follow them.
 */
export const webhookPolicy: AuthorizationPort<WebhookState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.readers.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: () => false,
};
