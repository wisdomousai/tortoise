import type { ExecutionContext } from '@agent-native/runtime';
import { createApplicationRuntime, type AnyApplicationDefinition } from './application';
import { assertGlobals } from './globals';
import { combineIntegrations } from './integrations';
import type { HostPlatform, PlatformOwnership } from './platform';
import { openPlugins } from './plugins/lifecycle';
import type { PluginSettings } from './plugins/settings';

/** The single workspace a local authority serves. */
export const LOCAL_WORKSPACE = 'local';
/** The principal a local authority starts as; it owns the workspace it creates. */
export const LOCAL_OWNER = 'owner';

export interface OpenAuthorityOptions {
  readonly platform: HostPlatform;
  /** Held by the caller, which acquired it from the same platform and releases it after `close`. */
  readonly ownership: PlatformOwnership;
  /** Audit source component: `authority` for a serving host, `embedded` in-process. */
  readonly component: 'authority' | 'embedded';
  /** True for a serving host, which may start background work and child processes. */
  readonly serving: boolean;
  readonly settings?: PluginSettings;
  /** Launcher settings override provided ones; development builds only. */
  readonly launcherSettingsWin?: boolean;
  /**
   * Check this launcher identity against the identity port before any state opens. `context`
   * undefined means the local owner. Omitted: no check, as for a one-shot embedded process whose
   * grant file the caller already applied.
   */
  readonly admit?: { readonly context?: ExecutionContext };
}

/**
 * Open one workspace's authority on any platform, in the order its guarantees need:
 *
 * 0. The JavaScript host must have every required global (see `installGlobals`).
 * 1. Plugins, and so the ports. One that refuses (an unusable policy, an unwritable audit log, a
 *    platform it does not run on) stops startup before the workspace is opened.
 * 2. Identity, when `admit` is given: a port that admits only a delegated grant must refuse the
 *    local owner before any state exists.
 * 3. Storage and the blob store, then the runtime with the event-log port and the plugins'
 *    services.
 * 4. Every plugin's `ready` hook (attestation, crash recovery), before any integration pass or
 *    request, so no new command reuses a cursor a recovery compares against.
 * 5. The application's integrations, built but not started; the caller starts them.
 * 6. A serving authority sweeps unreferenced blobs once. A failed sweep leaves them for the next
 *    start and never removes a referenced blob, so it does not stop startup.
 *
 * On failure everything opened here is closed again, newest first; the caller still holds and
 * releases `ownership`. `close` stops integrations, then storage, then the plugins, so nothing
 * that might still audit outlives the audit log. A serving host that interleaves its own
 * resources can instead close the returned parts itself in that order.
 */
export async function openAuthority(
  definition: AnyApplicationDefinition,
  options: OpenAuthorityOptions,
) {
  assertGlobals();
  const { platform, ownership } = options;
  const plugins = await openPlugins(definition, {
    platform,
    workspacePath: ownership.canonicalPath,
    component: options.component,
    instance: ownership.instance,
    serving: options.serving,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.launcherSettingsWin ? { launcherSettingsWin: true } : {}),
  });
  const { ports } = plugins;
  let storage: ReturnType<HostPlatform['openStorage']> | undefined;
  try {
    if (options.admit) ports.identity.admit(options.admit.context);
    storage = platform.openStorage(definition, ownership);
    const blobs = platform.openBlobs(ownership);
    const application = createApplicationRuntime(definition, {
      storage,
      hostComponents: platform.components,
      blobStore: (workspaceId) => (workspaceId === LOCAL_WORKSPACE ? blobs : undefined),
      ...(ports.eventLog ? { eventLog: ports.eventLog } : {}),
      services: { ...(definition.services as object), ...plugins.services },
    });
    await plugins.ready(application);
    const connections =
      definition.connect?.({
        application,
        workspaceId: LOCAL_WORKSPACE,
        network: ports.network,
        processes: ports.processes,
      }) ?? {};
    const integrations = combineIntegrations({
      application,
      workspaceId: LOCAL_WORKSPACE,
      connections,
    });
    if (options.serving) await application.sweepBlobs(LOCAL_WORKSPACE).catch(() => undefined);
    const opened = storage;
    let closed = false;
    return {
      plugins,
      ports,
      storage: opened,
      application,
      connections,
      integrations,
      /** Services the plugins expose, keyed by plugin id. */
      services: plugins.services,
      workspacePath: ownership.canonicalPath,
      /** Stop integrations, close storage, then the plugins. Ownership stays with the caller. */
      async close() {
        if (closed) return;
        closed = true;
        await integrations.stop();
        await opened.close();
        await plugins.close();
      },
    };
  } catch (error) {
    await storage?.close().catch(() => undefined);
    await plugins.close();
    throw error;
  }
}
export type Authority = Awaited<ReturnType<typeof openAuthority>>;
