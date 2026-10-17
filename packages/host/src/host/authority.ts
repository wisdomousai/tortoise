import { join } from 'node:path';
import type { AnyApplicationDefinition, Observer } from '@agent-native/kernel/application';
import { openAuthority as openOnPlatform } from '@agent-native/kernel/authority';
import { bunPlatform } from '../platform/bun';
import type { CleanupStack, StartHostOptions, WorkspaceOwnership } from './options';
import { SQLiteRunStore } from './run-store';

/**
 * Open the serving host's authority: the kernel's sequence on the Bun platform (plugins, the
 * launcher identity, storage, the runtime, the plugins' `ready` hooks, then the application's
 * integrations), followed by the run store agent runs record into. Each part registers its own
 * cleanup, so a failed startup and `close` in `startHost` release them newest first: observers,
 * run store, integrations, storage, plugins last, after everything that might still audit.
 */
export async function openAuthority(
  definition: AnyApplicationDefinition,
  options: StartHostOptions,
  ownership: WorkspaceOwnership,
  cleanup: CleanupStack,
) {
  const authority = await openOnPlatform(definition, {
    platform: options.platform ?? bunPlatform,
    ownership,
    component: 'authority',
    serving: true,
    ...(options.settings ? { settings: options.settings } : {}),
    // Identity before any state opens: a port that admits only the launcher's delegated grant
    // means the trusted local owner is never issued a session.
    admit: { context: options.agentConnection?.context },
  });
  cleanup.push(() => authority.plugins.close());
  cleanup.push(() => authority.storage.close());
  cleanup.push(() => authority.integrations.stop());
  const runStore = new SQLiteRunStore(join(ownership.canonicalPath, 'runs.sqlite'));
  cleanup.push(() => runStore.close());
  const observers: Observer[] = [];
  cleanup.push(async () => {
    await Promise.all(observers.map((observer) => observer.stop()));
  });
  return {
    plugins: authority.plugins,
    ports: authority.ports,
    storage: authority.storage,
    runStore,
    application: authority.application,
    connections: authority.connections,
    integrations: authority.integrations,
    observers,
    localOwner: authority.ports.identity.localOwnerSessions,
  };
}
export type Authority = Awaited<ReturnType<typeof openAuthority>>;
