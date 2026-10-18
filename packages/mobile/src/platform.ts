import { acquireExclusiveLock } from '@agent-native/adapters/exclusive-lock';
import { SnapshotStorage } from '@agent-native/adapters/snapshot-storage';
import type { SqlDriver } from '@agent-native/adapters/sql-driver';
import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/instance';
import type { HostPlatform, SecretStore } from '@agent-native/kernel/platform';
import { stateUpgrade } from '@agent-native/kernel/state-upgrade';
import type { BlobStore } from '@agent-native/runtime';

/**
 * What the device supplies to the mobile platform. The Expo bindings in `@agent-native/mobile/expo`
 * implement it with `expo-sqlite` and `expo-file-system`; tests implement it with Bun's.
 */
export interface MobileBindings {
  readonly id: 'android' | 'ios';
  /** A new connection to the app's database named `name`, created when missing. */
  openDatabase(name: string): SqlDriver;
  /** The blob store of workspace `workspace`, in the app's own storage. */
  openBlobs(workspace: string): BlobStore;
  /** The device's keychain or keystore; plugins get scoped views of it. */
  readonly secrets?: SecretStore;
}

/** A workspace on a device is a name, not a path: the app's sandbox holds every workspace. */
const workspaceName = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * The phone and tablet platform. It has no raw sockets, no child processes and no listener, so a
 * deployment that declares any of them refuses to start here. Ownership is an `EXCLUSIVE`
 * transaction on the workspace's lock database, held for as long as the instance is open, so a
 * background task cannot open a second writer while the screens hold one. Storage is the same
 * snapshot storage as on the desktop, over the device's SQLite.
 */
export function createMobilePlatform(bindings: MobileBindings): HostPlatform {
  return Object.freeze({
    id: bindings.id,
    capabilities: new Set<never>(),
    components: [],
    ...(bindings.secrets ? { secrets: bindings.secrets } : {}),
    async acquireOwnership(workspace: string) {
      if (!workspaceName.test(workspace))
        throw new Error(
          `Invalid workspace name "${workspace}": use lowercase letters, digits and -`,
        );
      const lock = acquireExclusiveLock(
        () => bindings.openDatabase(`${workspace}.lock.sqlite`),
        workspace,
      );
      return {
        canonicalPath: workspace,
        instance: crypto.randomUUID(),
        release: async () => lock.release(),
      };
    },
    openStorage(definition: AnyApplicationDefinition, ownership: { canonicalPath: string }) {
      const driver = bindings.openDatabase(`${ownership.canonicalPath}.workspace.sqlite`);
      driver.exec(
        'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
      );
      return new SnapshotStorage<unknown>(driver, () => definition.createState(LOCAL_OWNER), {
        upgrade: stateUpgrade(definition, LOCAL_OWNER),
      });
    },
    openBlobs: (ownership: { canonicalPath: string }) =>
      bindings.openBlobs(ownership.canonicalPath),
  });
}
