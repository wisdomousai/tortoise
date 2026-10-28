import type { JsonValue } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { AnyApplicationDefinition, HostedApplication, Observer } from '../application';
import { buildFacts } from '../build';
import { deploymentCatalog } from '../components';
import { assertPlatformSupports, scopedSecrets, type HostPlatform } from '../platform';
import type { CredentialSource, HostPorts, PluginInstance, PluginStartContext } from '../plugin';
import { defaultPorts, latePorts, resolvePorts } from './ports';
import { assertClaimed, mergeSettings, settingsFor, type PluginSettings } from './settings';

/** The parts of a platform that opening plugins needs. */
export type PluginPlatform = Pick<
  HostPlatform,
  'id' | 'capabilities' | 'components' | 'ingress' | 'secrets'
>;

export interface OpenPluginsOptions {
  readonly platform: PluginPlatform;
  readonly workspacePath: string;
  readonly component: 'host' | 'embedded';
  readonly instance: string;
  readonly serving: boolean;
  readonly settings?: PluginSettings;
  /** Launcher settings override provided ones; for development builds only (see `mergeSettings`). */
  readonly launcherSettingsWin?: boolean;
}

type Opened = { readonly id: string; readonly instance: PluginInstance };

/** Close in reverse opening order; a failing close never prevents the next one. */
async function closeAll(opened: readonly Opened[]) {
  for (const { instance } of [...opened].reverse()) await instance.close?.().catch(() => undefined);
}

/** Open each plugin in composition order, handing it the services of those before it. */
async function openEach(
  definition: AnyApplicationDefinition,
  options: OpenPluginsOptions,
  settings: PluginSettings,
) {
  const manifest = definition.manifest;
  const { platform } = options;
  const catalog = deploymentCatalog(manifest, platform.components);
  const build = buildFacts(manifest, definition.build);
  const services: Record<string, unknown> = {};
  const opened: Opened[] = [];
  const late = latePorts();
  try {
    for (const plugin of definition.plugins ?? []) {
      const id = plugin.manifest.id;
      const instance: PluginInstance = plugin.open
        ? await plugin.open({
            manifest,
            catalog,
            platform: { id: platform.id, capabilities: platform.capabilities },
            workspacePath: options.workspacePath,
            component: options.component,
            instance: options.instance,
            serving: options.serving,
            ...(build ? { build } : {}),
            settings: settingsFor(plugin.manifest, settings),
            ...(platform.secrets
              ? { secrets: scopedSecrets(platform.secrets, options.workspacePath, id) }
              : {}),
            services: { ...services },
            ports: late.ports,
          })
        : {};
      opened.push({ id, instance });
      if (instance.service !== undefined) services[id] = instance.service;
    }
    const ports = resolvePorts(opened, defaultPorts(platform.ingress));
    late.bind(ports);
    return { opened, services, ports };
  } catch (error) {
    await closeAll(opened);
    throw error;
  }
}

/**
 * Refuse a plugin that does not list this platform, and a deployment whose requirements the
 * platform cannot meet. Plugins without `platforms` run on Bun only.
 */
function assertRunsHere(definition: AnyApplicationDefinition, platform: PluginPlatform) {
  for (const plugin of definition.plugins ?? []) {
    const supported = plugin.manifest.platforms ?? ['bun'];
    if (!supported.includes(platform.id))
      throw new Error(`Plugin "${plugin.manifest.id}" does not run on platform "${platform.id}"`);
  }
  assertPlatformSupports(
    platform,
    deploymentCatalog(definition.manifest, platform.components).requirements,
  );
}

/**
 * Ask settings providers for other plugins' settings, in composition order, before any plugin
 * opens. A provider sees only its own launcher settings.
 */
async function provideSettings(definition: AnyApplicationDefinition, options: OpenPluginsOptions) {
  const launcher = options.settings ?? {};
  const provided = [];
  for (const plugin of definition.plugins ?? [])
    if (plugin.provideSettings)
      provided.push({
        id: plugin.manifest.id,
        settings: await plugin.provideSettings({
          manifest: definition.manifest,
          platform: { id: options.platform.id, capabilities: options.platform.capabilities },
          settings: settingsFor(plugin.manifest, launcher),
        }),
      });
  return mergeSettings(launcher, provided, options.launcherSettingsWin);
}

/**
 * Open the application's plugins before anything else in the workspace, so a plugin that refuses
 * (an unusable policy, an unwritable log) stops startup before state is opened. In order, before
 * any plugin opens: a plugin or requirement the platform cannot run is refused, launcher settings
 * no plugin claims are refused, settings providers run, and the merged settings are checked the
 * same way. A port a plugin `needs` that none provides is refused once all have opened. If any
 * `open` or that check fails, the plugins already opened are closed again.
 *
 * The caller then composes the runtime with `ports.eventLog` and `services`, runs `ready` before
 * serving, `start` once listening (serving hosts only), and `close` last.
 */
export async function openPlugins(
  definition: AnyApplicationDefinition,
  options: OpenPluginsOptions,
) {
  assertRunsHere(definition, options.platform);
  assertClaimed(definition.manifest, options.settings ?? {});
  const settings = await provideSettings(definition, options);
  assertClaimed(definition.manifest, settings);
  const { opened, services, ports } = await openEach(definition, options, settings);
  let closed = false;
  return {
    ports: ports as HostPorts,
    services: services as Readonly<Record<string, unknown>>,
    /** Each plugin's `ready`, in order. Must precede the first request or integration pass. */
    async ready(application: HostedApplication) {
      for (const { instance } of opened) await instance.ready?.(application);
    },
    /** Each plugin's `start`, in order; their observers are returned for the host to stop. */
    async start(context: Omit<PluginStartContext, 'ports'>): Promise<Observer[]> {
      const observers: Observer[] = [];
      for (const { instance } of opened)
        if (instance.start) observers.push(...(await instance.start({ ...context, ports })));
      return observers;
    },
    /** The first plugin response to a request no session covers, in composition order. */
    async publicRoute(request: Request): Promise<Response | undefined> {
      for (const { instance } of opened) {
        const response = await instance.publicRoute?.(request);
        if (response) return response;
      }
      return undefined;
    },
    /**
     * The caller a plugin-issued credential stands for, from the first plugin that knows it. A
     * bearer token is offered only to `authenticate` and a cookie only to `authenticateCookie`.
     */
    async authenticate(
      token: string,
      via: CredentialSource = 'bearer',
      request?: Request,
    ): Promise<ExecutionContext | undefined> {
      for (const { instance } of opened) {
        const context = await (via === 'cookie'
          ? instance.authenticateCookie?.(token)
          : instance.authenticate?.(token, request));
        if (context) return context;
      }
      return undefined;
    },
    /** The first plugin response to an authenticated request the host did not route. */
    async route(request: Request, context: ExecutionContext): Promise<Response | undefined> {
      for (const { instance } of opened) {
        const response = await instance.route?.(request, context);
        if (response) return response;
      }
      return undefined;
    },
    /** The harnesses the plugins offer the host's run route, in composition order. */
    harnesses(): readonly object[] {
      return opened.flatMap(({ instance }) => instance.harnesses ?? []);
    },
    /** The plugins' facts for the `listening` record, keyed by plugin id. */
    describe(): Record<string, JsonValue> {
      return Object.fromEntries(
        opened.map(({ id, instance }) => [id, instance.describe?.() ?? {}] as const),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      await closeAll(opened);
    },
  };
}
export type OpenedPlugins = Awaited<ReturnType<typeof openPlugins>>;
