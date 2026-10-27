import type { BlobRef, PeerTarget } from '@agent-native/contracts';
import type { Effect } from '@agent-native/runtime';
import { createPeerPort } from '../peer-port.js';
import { connectTarget, type TargetIntegration, type TargetIntegrationOptions } from '../target.js';
import type { PeerDrift } from './drift.js';
import type { PeerLink } from './link.js';

export interface PeerTargetOptions<Item> {
  readonly target: PeerTarget;
  readonly application: TargetIntegrationOptions<Item>['application'];
  readonly workspaceId: string;
  /** The target's integration principal, which completes outcomes and applies the feed. */
  readonly principalId: string;
  /** The connection; throws while the peer is not connected, which keeps effects pending. */
  readonly link: () => PeerLink;
  readonly readBlob: (
    effect: Readonly<Effect>,
    digest: string,
  ) => Promise<{ readonly ref: BlobRef; readonly data: Uint8Array } | undefined>;
  readonly reference?: (result: unknown, effect: Readonly<Effect>) => string | undefined;
  readonly drift?: PeerDrift;
  readonly toInput?: TargetIntegrationOptions<Item>['toInput'];
}

/**
 * Wire a peer target (`definePeerTarget`) to the peer link. A command on the API's service
 * list is delivered as this application's service principal; one on its `onBehalfOf` list is
 * delivered on behalf of the person who enqueued it (`effect.principalId`), so the peer applies
 * that person's policy. The feed is read as the service principal.
 */
export function connectPeerTarget<Item>(options: PeerTargetOptions<Item>): TargetIntegration<Item> {
  const { target } = options;
  return connectTarget<Item>({
    target,
    application: options.application,
    workspaceId: options.workspaceId,
    principalId: options.principalId,
    ...(options.toInput ? { toInput: options.toInput } : {}),
    port: createPeerPort<Item>({
      target: target.target,
      client: (effect) =>
        effect && target.onBehalfOf(effect.type)
          ? options.link().onBehalfOf(effect.principalId, { run: effect.runId !== undefined })
          : options.link().client(),
      readBlob: options.readBlob,
      ...(target.feedQuery ? { feed: target.feedQuery } : {}),
      ...(options.reference ? { reference: options.reference } : {}),
      ...(options.drift ? { drift: options.drift } : {}),
      reconnect: {
        missing: 'connect it on the peers screen',
        refused: 'connect it again on the peers screen',
      },
    }),
  });
}
