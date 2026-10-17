import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  ApplicationError,
  blobDigestPattern,
  blobFits,
  mediaTypePattern,
  type AuditRecord,
  type BlobRef,
} from '@agent-native/contracts';
import type { ExecutionContext } from '../types.js';
import { actorOf } from './audit.js';
import { ownRecord, readable, storeOf } from './blob-references.js';
import { grantPermits } from './delegation.js';
import type { Kernel } from './kernel.js';

type BlobKind = 'blob.stored' | 'blob.read' | 'blob.denied';

function blobRecord(
  kind: BlobKind,
  context: ExecutionContext,
  digest: string | undefined,
  reason?: string,
): AuditRecord {
  return {
    kind,
    outcome: kind === 'blob.denied' ? 'denied' : 'info',
    actor: actorOf(context),
    ...(reason ? { reason } : {}),
    ...(digest ? { data: { digest } } : {}),
  };
}

/** Run `action` and record its outcome by digest: `kind` on success, `blob.denied` otherwise. */
async function audited<State, Services, T>(
  kernel: Kernel<State, Services>,
  kind: Exclude<BlobKind, 'blob.denied'>,
  context: ExecutionContext,
  digest: string | undefined,
  action: () => Promise<T>,
) {
  try {
    const result = await action();
    await kernel.audit.after([blobRecord(kind, context, digest)]);
    return result;
  } catch (error) {
    const code = error instanceof ApplicationError ? error.code : 'INTERNAL';
    await kernel.audit.after([blobRecord('blob.denied', context, digest, code)]);
    throw error;
  }
}

/** Whether some operation this context may invoke would attach a blob of this size and type. */
function accepted<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  size: number,
  mediaType: string,
) {
  const now = kernel.now();
  for (const capability of kernel.capabilities.values())
    if (
      capability.blobs &&
      grantPermits(context.grant, now, capability.id) &&
      blobFits(capability.blobs, size, mediaType)
    )
      return true;
  return false;
}

/**
 * Store bytes and stage them for the uploader. Refused unless some operation the caller may
 * invoke accepts this size and media type, so the largest declared limit bounds every upload.
 * Storing is idempotent by content; nothing references the blob until a command attaches it.
 */
async function putBlob<State, Services>(
  kernel: Kernel<State, Services>,
  data: Uint8Array,
  mediaType: string,
  context: ExecutionContext,
): Promise<BlobRef> {
  kernel.guard.trusted(context);
  if (
    !(data instanceof Uint8Array) ||
    !mediaTypePattern.test(mediaType) ||
    !accepted(kernel, context, data.byteLength, mediaType)
  ) {
    await kernel.audit.after([blobRecord('blob.denied', context, undefined, 'INVALID_INPUT')]);
    throw new ApplicationError('INVALID_INPUT', 'No operation accepts this blob');
  }
  const digest = `sha256:${bytesToHex(sha256(data))}`;
  return audited(kernel, 'blob.stored', context, digest, async () => {
    const store = storeOf(kernel, context.workspaceId);
    await kernel.uploads.exclusive(context.workspaceId, () => store.put(digest, data));
    kernel.guard.trusted(context);
    kernel.uploads.stage(context, digest);
    return { digest, size: data.byteLength, mediaType };
  });
}

/** A blob the caller may read through a resource that references it. Otherwise NOT_FOUND. */
function readBlob<State, Services>(
  kernel: Kernel<State, Services>,
  digest: string,
  context: ExecutionContext,
) {
  kernel.guard.trusted(context);
  return audited(kernel, 'blob.read', context, digest, async () => {
    const record = blobDigestPattern.test(digest)
      ? await kernel.options.storage.read(context.workspaceId, async (snapshot) => {
          const found = ownRecord(snapshot, digest);
          return found && (await readable(kernel, context, snapshot, found)) ? found : undefined;
        })
      : undefined;
    kernel.guard.trusted(context);
    const data = record && (await storeOf(kernel, context.workspaceId).get(digest));
    if (!record || !data) throw new ApplicationError('NOT_FOUND', 'Blob unavailable');
    return { ref: { digest, size: record.size, mediaType: record.mediaType }, data };
  });
}

/**
 * Trusted host call for connectors: a blob attached to the resource an effect reports on, so a
 * connector can upload it before delivering the effect. Undefined when either is unknown.
 */
async function readEffectBlob<State, Services>(
  kernel: Kernel<State, Services>,
  workspaceId: string,
  effectId: string,
  digest: string,
) {
  const record = await kernel.options.storage.read(workspaceId, async (snapshot) => {
    const effect = Object.hasOwn(snapshot.effects, effectId)
      ? snapshot.effects[effectId]
      : undefined;
    const found = ownRecord(snapshot, digest);
    return effect && found?.resources.includes(effect.resource) ? found : undefined;
  });
  const data = record && (await storeOf(kernel, workspaceId).get(digest));
  if (!record || !data) return undefined;
  return { ref: { digest, size: record.size, mediaType: record.mediaType }, data };
}

/**
 * Remove blobs no resource references that were stored more than the grace period ago. Holds
 * the upload lock and a read of the workspace, so no upload or commit interleaves; a blob
 * stored again within the grace period has a fresh `storedAt` and stays.
 */
function sweepBlobs<State, Services>(
  kernel: Kernel<State, Services>,
  workspaceId: string,
): Promise<{ readonly removed: number }> {
  const store = storeOf(kernel, workspaceId);
  return kernel.uploads.exclusive(workspaceId, () =>
    kernel.options.storage.read(workspaceId, async (snapshot) => {
      const cutoff = kernel.now() - kernel.uploads.graceMs;
      let removed = 0;
      for (const digest of await store.list()) {
        if (ownRecord(snapshot, digest)) continue;
        const stored = await store.stat(digest);
        if (!stored || stored.storedAt > cutoff) continue;
        await store.remove(digest);
        removed++;
      }
      return { removed };
    }),
  );
}

/** Uploads, reads, connector reads and sweeping of one application's blobs. */
export function createBlobs<State, Services>(kernel: Kernel<State, Services>) {
  return {
    putBlob: (data: Uint8Array, mediaType: string, context: ExecutionContext) =>
      putBlob(kernel, data, mediaType, context),
    readBlob: (digest: string, context: ExecutionContext) => readBlob(kernel, digest, context),
    readEffectBlob: (workspaceId: string, effectId: string, digest: string) =>
      readEffectBlob(kernel, workspaceId, effectId, digest),
    sweepBlobs: (workspaceId: string) => sweepBlobs(kernel, workspaceId),
  };
}
