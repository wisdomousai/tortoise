import type { AuthorizationPort, HandlerContribution } from '@tortoise/runtime';
import { hubLinkModule, hubLinkOperations as ops } from './contracts';

export interface Pairing {
  origin: string;
  deviceId: string;
  label: string;
  kind: 'field-sync' | 'attached';
  pairedAt: number;
}

/** The device side's slice, under `state['hub-link']`. The credential is in the keystore. */
export interface HubLinkState {
  owners: string[];
  pairing: Pairing | null;
  lastError?: string;
}

export const createHubLinkState = (ownerId: string): HubLinkState => ({
  owners: [ownerId],
  pairing: null,
});

const resource = 'hub-pairing:current';

export const hubLinkHandlers: HandlerContribution<HubLinkState, unknown>[] = [
  {
    capability: ops.pairingGet,
    handle: async (_input, ctx) => ({
      pairing: ctx.state.pairing,
      ...(ctx.state.lastError === undefined ? {} : { lastError: ctx.state.lastError }),
    }),
  },
  {
    capability: ops.pairingRecord,
    handle: async (input, ctx) => {
      const record = input as { pairing: Pairing } | { error: string };
      if ('pairing' in record) {
        ctx.state.pairing = { ...record.pairing };
        delete ctx.state.lastError;
      } else ctx.state.lastError = record.error;
      ctx.change(resource, 'pairing' in record ? 'hub.paired' : 'hub.pairing-failed');
      return { paired: ctx.state.pairing !== null };
    },
  },
  {
    capability: ops.pairingClear,
    handle: async (_input, ctx) => {
      ctx.state.pairing = null;
      delete ctx.state.lastError;
      ctx.change(resource, 'hub.unpaired');
      return { paired: false as const };
    },
  },
];

const known = new Set<string>(hubLinkModule.capabilities.map((capability) => capability.id));

/** The person holding the device reads and changes the pairing; nobody else exists here. */
export const hubLinkPolicy: AuthorizationPort<HubLinkState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.owners.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ context, state }) => state.owners.includes(context.principalId),
};
