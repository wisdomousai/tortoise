import { ApplicationError, type BlobRef } from '@tortoise/contracts';
import type { BlobRecord, ExecutionContext, WorkspaceSnapshot } from '../types.js';
import { grantCoversResource } from './delegation.js';
import type { Kernel } from './kernel.js';
import { byCodePoint, defineOwn, revisionOf } from './records.js';

/** A reference change a handler requested; applied at commit by `applyBlobChanges`. */
export type BlobChange =
  | { readonly kind: 'attach'; readonly resource: string; readonly ref: BlobRef }
  | { readonly kind: 'detach'; readonly resource: string; readonly digest: string };

export const ownRecord = (snapshot: Readonly<WorkspaceSnapshot<unknown>>, digest: string) =>
  Object.hasOwn(snapshot.blobs, digest) ? snapshot.blobs[digest] : undefined;

export function storeOf<State, Services>(kernel: Kernel<State, Services>, workspaceId: string) {
  const store = kernel.options.blobStore?.(workspaceId);
  if (!store) throw new ApplicationError('UNAVAILABLE', 'Blob storage unavailable');
  return store;
}

/** Whether the context may read one of the resources that reference a blob. */
export async function readable<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  snapshot: Readonly<WorkspaceSnapshot<State>>,
  record: BlobRecord,
): Promise<boolean> {
  const { authorization } = kernel.options;
  for (const resource of record.resources) {
    if (!grantCoversResource(context.grant, resource)) continue;
    const event = {
      cursor: snapshot.cursor,
      resource,
      revision: revisionOf(snapshot, resource),
      type: 'blob.read',
      operation: 'blob.read',
    };
    const allowed = authorization.canReadResource
      ? await authorization.canReadResource({ resource, event, context, state: snapshot.state })
      : await authorization.canReadEvent({ event, context, state: snapshot.state });
    if (allowed) return true;
  }
  return false;
}

function detach<State>(snapshot: WorkspaceSnapshot<State>, resource: string, digest: string) {
  const record = ownRecord(snapshot, digest);
  if (!record) return;
  const resources = record.resources.filter((entry) => entry !== resource);
  if (resources.length) defineOwn(snapshot.blobs, digest, { ...record, resources });
  else delete snapshot.blobs[digest];
}

/**
 * Apply a command's reference changes to the draft snapshot, in the order the handler made them.
 * Runs inside the transaction before the commit-phase authorization, which rechecks the context
 * after these awaits. An attach needs the blob in the store with the referenced size, and the
 * caller must have uploaded it within the grace period or already be able to read it. Every
 * refusal is the same INVALID_INPUT, so a caller cannot probe which blobs exist.
 */
export async function applyBlobChanges<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  snapshot: WorkspaceSnapshot<State>,
  changes: readonly BlobChange[],
) {
  for (const change of changes) {
    if (change.kind === 'detach') {
      detach(snapshot, change.resource, change.digest);
      continue;
    }
    const { ref, resource } = change;
    const record = ownRecord(snapshot, ref.digest);
    const store = storeOf(kernel, context.workspaceId);
    const permitted =
      (await kernel.uploads.isStaged(context, ref.digest, store)) ||
      (record !== undefined && (await readable(kernel, context, snapshot, record)));
    const stored = permitted ? await store.stat(ref.digest) : undefined;
    if (!stored || stored.size !== ref.size || (record && record.mediaType !== ref.mediaType))
      throw new ApplicationError('INVALID_INPUT', 'Blob is unavailable');
    defineOwn(snapshot.blobs, ref.digest, {
      size: ref.size,
      mediaType: ref.mediaType,
      resources: [...new Set([...(record?.resources ?? []), resource])].sort(byCodePoint),
    });
  }
}
