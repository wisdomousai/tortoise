import { defineFeature } from '@agent-native/host/feature';
import {
  isDelegated,
  own,
  put,
  type ExecutionContext,
  type FeatureHandler,
  type FeaturePolicy,
} from '@agent-native/runtime';
import { handoverFeatureManifest, handoverOperations, type HandoverEntry } from './contracts';

/** What a caller does in the handover feature. */
export type HandoverAction = 'read' | 'record';

/**
 * The application's decision on who may do what. The application's policy never sees this
 * feature's operations, so `allows` applies its membership gate and integration allowlists itself.
 * Newest entries come first: the list sorts by `recordedAt`, then by key.
 */
export interface HandoverAccess {
  allows(context: ExecutionContext, action: HandoverAction): boolean;
}

/** Application code the feature calls; each defaults when the application omits it. */
export interface HandoverHooks {
  newId?(): string;
  now?(): number;
}

/** The feature's state slice, under `handover` in the application's state. */
export interface HandoverSlice {
  readonly entries: Record<string, HandoverEntry>;
}

const ops = handoverOperations;
const actionOf = (operation: string): HandoverAction =>
  operation === ops.handoverRecord.id ? 'record' : 'read';

/**
 * Reads need `read` and recording needs `record`, under the access view of the state being
 * committed and of the previous state. Recording is person-only for every application.
 */
// #region policy
const policy: FeaturePolicy<HandoverSlice, HandoverAccess> = {
  authorize({ capability, context, access, previousAccess }) {
    if (capability.id === ops.handoverRecord.id && isDelegated(context))
      return { allowed: false, reason: 'PERSON_ONLY' };
    const action = actionOf(capability.id);
    const allowed =
      access.allows(context, action) && (!previousAccess || previousAccess.allows(context, action));
    return allowed ? { allowed: true } : { allowed: false, reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ event, state, context, access }) =>
    !!own(state.entries, event.resource.slice('handover:'.length)) &&
    access.allows(context, 'read'),
};
// #endregion policy

type Handler<C extends (typeof ops)[keyof typeof ops]> = FeatureHandler<
  HandoverSlice,
  unknown,
  HandoverAccess,
  HandoverHooks,
  C
>;
const list: Handler<typeof ops.handoverList> = {
  capability: ops.handoverList,
  handle: (_input, ctx) => ({
    items: Object.values(ctx.state.entries).sort(
      (a, b) => b.recordedAt - a.recordedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  }),
};
const record: Handler<typeof ops.handoverRecord> = {
  capability: ops.handoverRecord,
  handle: (input, ctx) => {
    const id = ctx.hooks.newId?.() ?? crypto.randomUUID();
    const entry = {
      id,
      shift: input.shift,
      text: input.text,
      recordedBy: ctx.context.principalId,
      recordedAt: ctx.hooks.now?.() ?? Date.now(),
    };
    put(ctx.state.entries, id, entry);
    ctx.change(`handover:${id}`);
    return entry;
  },
};

/**
 * The handover feature: entries in the `handover` slice. Mount it with
 * `mountFeature(handoverFeature(), { access, hooks })`; add a slice migration whenever the
 * entry shape changes.
 */
export function handoverFeature() {
  return defineFeature<HandoverSlice, HandoverAccess, HandoverHooks>({
    manifest: handoverFeatureManifest,
    state: { create: () => ({ entries: {} }) },
    handlers: [list, record],
    authorization: { resourceTypes: ['handover'], port: policy },
  });
}
