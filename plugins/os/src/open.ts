import type { OsActionKind, OsHandlerKind } from '@agent-native/contracts';
import type { PluginInstance, PluginOpenContext, ShellPort } from '@agent-native/host/plugin';
import { webScheme } from '@agent-native/shell';
import { createOsAudit, createRateLimit } from './audit';
import {
  assertServed,
  baseActionKinds,
  baseHandlerKinds,
  collectDeclarations,
  listSetting,
} from './declarations';
import { createAdapters, performOsAction } from './perform';
import { receiveOsRequest, type OsConsumer } from './receive';

/**
 * What the OS plugin exposes to later plugins as `services.os`. A capability plugin (share
 * target, notifications, Android intents, shortcuts) enables the kinds it serves and registers
 * receivers for the handlers that name it as their consumer, during its own `open`.
 */
export interface OsService {
  enable(kinds: { handlers?: readonly OsHandlerKind[]; actions?: readonly OsActionKind[] }): void;
  consume(consumer: string, receive: OsConsumer): void;
  /** Declared handlers and actions, attached adapter platforms and recent activity. */
  status(): {
    readonly handlers: readonly { id: string; kind: OsHandlerKind; disabled: boolean }[];
    readonly actions: readonly { id: string; kind: OsActionKind; disabled: boolean }[];
    readonly attached: readonly string[];
    readonly recent: ReturnType<ReturnType<typeof createOsAudit>['recent']>;
  };
}

/** Requests per handler and actions per action in any minute. */
const perMinute = 30;

/**
 * Open the OS plugin: collect the composed declarations, read the scheme, verified link hosts
 * and disabled ids from launcher settings, and provide the shell port. `ready` refuses startup
 * when a declared kind or consumer is served by no composed plugin.
 */
export function openOs(options: { now?: () => number } = {}) {
  return async (context: PluginOpenContext): Promise<PluginInstance> => {
    const now = options.now ?? Date.now;
    const declarations = collectDeclarations(context.manifest);
    const scheme = context.settings['os-scheme'];
    const disabled = listSetting(context.settings['os-disabled']);
    const enabled = { handlers: new Set(baseHandlerKinds), actions: new Set(baseActionKinds) };
    const consumers = new Map<string, OsConsumer>();
    const audit = createOsAudit(() => context.ports.eventLog, now);
    const adapters = createAdapters();
    const disabledSet = new Set(disabled);
    const receiving = {
      declarations,
      catalog: context.catalog,
      match: {
        schemes: scheme ? [scheme, webScheme(scheme)] : [],
        linkHosts: listSetting(context.settings['os-link-hosts']),
      },
      disabled: disabledSet,
      consumers,
      allow: createRateLimit(perMinute, 60_000, now),
      audit,
    };
    const performing = {
      declarations,
      disabled: disabledSet,
      allow: createRateLimit(perMinute, 60_000, now),
      root: () => undefined,
      adapters,
      audit,
    };
    const shell: ShellPort = {
      receive: (caller, raw, platform) => receiveOsRequest(receiving, caller, raw, platform),
      perform: (caller, request) => performOsAction(performing, caller, request),
      attach: (caller, adapter) => adapters.attach(caller, adapter),
    };
    const service: OsService = {
      enable(kinds) {
        for (const kind of kinds.handlers ?? []) enabled.handlers.add(kind);
        for (const kind of kinds.actions ?? []) enabled.actions.add(kind);
      },
      consume(consumer, receive) {
        if (consumers.has(consumer)) throw new Error(`OS consumer ${consumer} is registered twice`);
        consumers.set(consumer, receive);
      },
      status: () => ({
        handlers: declarations.handlers.map(({ id, kind }) => ({
          id,
          kind,
          disabled: disabledSet.has(id),
        })),
        actions: [...declarations.actions.values()].map(({ id, kind }) => ({
          id,
          kind,
          disabled: disabledSet.has(id),
        })),
        attached: adapters.platforms(),
        recent: audit.recent(),
      }),
    };
    return {
      ports: { shell },
      service,
      ready: async () => assertServed(declarations, enabled, new Set(consumers.keys()), disabled),
      describe: () => ({
        handlers: declarations.handlers.length,
        actions: declarations.actions.size,
        ...(scheme ? { scheme } : {}),
      }),
    };
  };
}

/** The OS plugin's service among a host's plugin services; throws when it is not composed. */
export function osServiceOf(services: Readonly<Record<string, unknown>>): OsService {
  const service = services.os as OsService | undefined;
  if (!service) throw new Error('This application does not compose the OS plugin');
  return service;
}
