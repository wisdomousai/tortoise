import {
  createMemoryBlobStore,
  createMemoryStorage,
  type BlobStore,
  type Storage,
} from '@tortoise/runtime';
import type { HostPlatform, PlatformCapability, PlatformId } from '../src/platform';

/**
 * A platform made of memory only, standing in for a phone in tests: ownership is a set of held
 * paths, and each workspace keeps one memory store across close and reopen, so a test can show
 * persistence without a file system. Storage opens and closes are recorded in `events`.
 * `blobClock` dates stored blobs, so a test can store one that is already past the grace period.
 */
export function fakePlatform(
  options: {
    id?: PlatformId;
    capabilities?: readonly PlatformCapability[];
    blobClock?: () => number;
  } = {},
) {
  const held = new Set<string>();
  const stores = new Map<string, Storage<unknown>>();
  const blobStores = new Map<string, BlobStore>();
  const events: string[] = [];
  let instances = 0;
  const platform: HostPlatform = {
    id: options.id ?? 'android',
    capabilities: new Set(options.capabilities ?? []),
    components: [],
    async acquireOwnership(workspacePath) {
      if (held.has(workspacePath)) throw new Error(`Workspace ${workspacePath} is owned`);
      held.add(workspacePath);
      let released = false;
      return {
        canonicalPath: workspacePath,
        instance: `instance-${++instances}`,
        async release() {
          if (released) return;
          released = true;
          held.delete(workspacePath);
        },
      };
    },
    openStorage(definition, ownership) {
      const path = ownership.canonicalPath;
      events.push(`open storage ${path}`);
      let store = stores.get(path);
      if (!store) {
        store = createMemoryStorage(() => definition.createState('owner'));
        stores.set(path, store);
      }
      const { transact, read } = store;
      return {
        transact,
        read,
        async close() {
          events.push(`close storage ${path}`);
        },
      };
    },
    openBlobs(ownership) {
      const path = ownership.canonicalPath;
      let store = blobStores.get(path);
      if (!store) {
        store = createMemoryBlobStore(options.blobClock);
        blobStores.set(path, store);
      }
      return store;
    },
  };
  return { platform, held, events };
}
