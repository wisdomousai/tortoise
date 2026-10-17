import { createDirectTransport } from '@agent-native/adapters/direct-transport';
import type { AnyApplicationDefinition, Observer } from '@agent-native/kernel/application';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openAuthority } from '@agent-native/kernel/authority';
import type { HostPlatform } from '@agent-native/kernel/platform';
import type { PluginSettings } from '@agent-native/kernel/plugins/settings';

export interface MobileAuthorityOptions {
  readonly platform: HostPlatform;
  /** The workspace's name on this device. Defaults to the application's id. */
  readonly workspace?: string;
  readonly settings?: PluginSettings;
  /** Development builds only: settings the app was launched with override managed ones. */
  readonly launcherSettingsWin?: boolean;
  /** How often the screens' live queries poll the journal. Defaults to 250 ms. */
  readonly pollMs?: number;
}

/**
 * Open the application's authority inside the app, for the person holding the device. The screens
 * talk to it through the direct transport as the local owner; there is no listener and no session.
 * The authority sweeps unreferenced blobs when it opens. Integrations, plugin observers (such as
 * a notification dispatcher) and the application's observers are built but stopped: call
 * `foreground` when the app becomes active and `background` when it leaves, and
 * `backgroundPass` from a background task. `close` stops everything and releases ownership.
 *
 * Fails when another authority in this app or process holds the workspace, and when a plugin or a
 * declared requirement cannot run on this platform; nothing stays open after a failure.
 */
export async function openMobileAuthority(
  definition: AnyApplicationDefinition,
  options: MobileAuthorityOptions,
) {
  const { platform } = options;
  const ownership = await platform.acquireOwnership(options.workspace ?? definition.manifest.id);
  let authority: Awaited<ReturnType<typeof openAuthority>>;
  try {
    authority = await openAuthority(definition, {
      platform,
      ownership,
      component: 'embedded',
      serving: true,
      ...(options.settings ? { settings: options.settings } : {}),
      ...(options.launcherSettingsWin ? { launcherSettingsWin: true } : {}),
      admit: {},
    });
  } catch (error) {
    await ownership.release();
    throw error;
  }
  const context = {
    workspaceId: LOCAL_WORKSPACE,
    principalId: LOCAL_OWNER,
    channel: 'direct' as const,
  };
  const transport = createDirectTransport(authority.application, context, {
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
  });
  let active = false;
  let closed = false;
  // Observers only stop, so each foreground starts them again and each background stops them.
  let observers: Promise<readonly Observer[]> = Promise.resolve([]);
  const onError = (scope: string, error: unknown) => console.warn(`${scope}:`, error);
  async function startObservers(): Promise<readonly Observer[]> {
    try {
      const started = await authority.plugins.start({
        application: authority.application,
        workspaceId: LOCAL_WORKSPACE,
        delegate: (grant) => ({
          workspaceId: LOCAL_WORKSPACE,
          principalId: LOCAL_OWNER,
          grant: { ...grant, principalId: LOCAL_OWNER, workspaceId: LOCAL_WORKSPACE },
        }),
        onError,
      });
      const observed = authority.connections.observe
        ? await authority.connections.observe(onError)
        : [];
      return [...started, ...observed];
    } catch (error) {
      onError('Starting observers', error);
      return [];
    }
  }
  async function stopObservers() {
    const running = await observers;
    observers = Promise.resolve([]);
    await Promise.all(running.map((observer) => observer.stop()));
  }
  return {
    authority,
    transport,
    context,
    /** Start delivery and inbound sync loops and the plugin and application observers; idempotent. */
    foreground() {
      if (active || closed) return;
      active = true;
      authority.integrations.start();
      const previous = observers;
      observers = previous.then(startObservers);
    },
    /** Stop the loops and observers while the app is not visible. */
    async background() {
      if (!active) return;
      active = false;
      await Promise.all([authority.integrations.stop(), stopObservers()]);
    },
    /**
     * One bounded delivery and sync pass for a background task, which the OS may stop at any
     * time. Undelivered effects stay in the outbox for the next pass.
     */
    async backgroundPass(timeoutMs = 20_000) {
      const delivered = await authority.integrations.drain(timeoutMs);
      const synced = await authority.integrations.sync();
      return { delivered, synced };
    },
    async close() {
      if (closed) return;
      closed = true;
      active = false;
      try {
        await stopObservers();
        await authority.close();
      } finally {
        await ownership.release();
      }
    },
  };
}
export type MobileAuthority = Awaited<ReturnType<typeof openMobileAuthority>>;
