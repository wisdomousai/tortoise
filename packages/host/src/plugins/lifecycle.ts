import type { JsonValue } from '@agent-native/contracts';
import type { AnyApplicationDefinition, HostedApplication, Observer } from '../application';
import { deploymentCatalog } from '../components';
import type { HostPorts, PluginInstance, PluginStartContext } from '../plugin';
import { resolvePorts } from './ports';
import { assertClaimed, settingsFor, type PluginSettings } from './settings';

export interface OpenPluginsOptions {
  readonly workspacePath: string;
  readonly component: 'authority' | 'embedded';
  readonly instance: string;
  readonly serving: boolean;
  readonly settings?: PluginSettings;
}

type Opened = { readonly id: string; readonly instance: PluginInstance };

/** Close in reverse opening order; a failing close never prevents the next one. */
async function closeAll(opened: readonly Opened[]) {
  for (const { instance } of [...opened].reverse()) await instance.close?.().catch(() => undefined);
}

/** Open each plugin in composition order, handing it the services of those before it. */
async function openEach(definition: AnyApplicationDefinition, options: OpenPluginsOptions) {
  const manifest = definition.manifest;
  const catalog = deploymentCatalog(manifest);
  const services: Record<string, unknown> = {};
  const opened: Opened[] = [];
  try {
    for (const plugin of definition.plugins ?? []) {
      const id = plugin.manifest.id;
      const instance: PluginInstance = plugin.open
        ? await plugin.open({
            manifest,
            catalog,
            workspacePath: options.workspacePath,
            component: options.component,
            instance: options.instance,
            serving: options.serving,
            settings: settingsFor(plugin.manifest, options.settings ?? {}),
            services: { ...services },
          })
        : {};
      opened.push({ id, instance });
      if (instance.service !== undefined) services[id] = instance.service;
    }
    return { opened, services, ports: resolvePorts(opened) };
  } catch (error) {
    await closeAll(opened);
    throw error;
  }
}

/**
 * Open the application's plugins before anything else in the workspace, so a plugin that refuses
 * (an unusable policy, an unwritable log) stops startup before state is opened. Settings no
 * plugin claims are refused first. If any `open` fails, those already opened are closed again.
 *
 * The caller then composes the runtime with `ports.eventLog` and `services`, runs `ready` before
 * serving, `start` once listening (serving hosts only), and `close` last.
 */
export async function openPlugins(
  definition: AnyApplicationDefinition,
  options: OpenPluginsOptions,
) {
  assertClaimed(definition.manifest, options.settings ?? {});
  const { opened, services, ports } = await openEach(definition, options);
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
