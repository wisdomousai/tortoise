import { randomUUID } from 'node:crypto';
import { localHarness, type LocalModel } from '@tortoise/agents/local';
import { satisfiesModel } from '@tortoise/agents/placement';
import { LOCAL_INFERENCE_DESTINATION } from '@tortoise/agents/requirements';
import type { Harness } from '@tortoise/agents/types';
import { defineHostPlugin, type HostPorts } from '@tortoise/host/plugin';
import type { TriggerDefinition } from './contracts';
import type { Job } from './jobs';
import { startLoop } from './loop';
import { automationPluginManifest } from './plugin-manifest';
import { createTriggerRuns } from './run';
import {
  automationHandlers,
  automationPolicy,
  createAutomationState,
  type AutomationServices,
  type AutomationState,
} from './server';
import { resolveTriggers } from './triggers';

export interface AutomationOptions {
  readonly triggers: readonly TriggerDefinition[];
  /** Jobs the triggers run, by ID. Server code: they reach state only through operations. */
  readonly jobs?: Readonly<Record<string, Job>>;
  /**
   * A model on this host for agents that require `local` (or allow `any`), reached only through
   * the network port's `local-inference` destination, which the site policy binds to a loopback
   * address. Listed before `agentHarnesses`, so it is preferred where both qualify.
   */
  readonly localModel?: LocalModel;
  /** Further harnesses agent triggers may run with, such as a provider harness. */
  readonly agentHarnesses?: readonly Harness[];
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/**
 * The automation plugin. Triggers are checked against the catalog when it opens; a serving host
 * then runs each trigger that has an active trigger grant, as that grant's issuer. Nothing
 * runs in an embedded host or for a trigger no person enabled.
 */
export function createAutomationPlugin(options: AutomationOptions) {
  const jobs = new Map(Object.entries(options.jobs ?? {}));
  const now = options.now ?? Date.now;
  return defineHostPlugin<AutomationState, AutomationServices>({
    manifest: automationPluginManifest,
    state: { create: createAutomationState },
    handlers: automationHandlers,
    authorization: {
      resourceTypes: ['trigger-grant', 'trigger-failure'],
      port: automationPolicy,
    },
    async open({ catalog }) {
      const triggers = resolveTriggers(options.triggers, catalog, jobs);
      // Ports resolve only once every plugin opened, so the local harness looks them up per call.
      let ports: HostPorts | undefined;
      const harnesses = agentHarnesses(options, () => ports!);
      for (const trigger of triggers.values())
        if (
          trigger.model &&
          !harnesses.some((harness) => satisfiesModel(trigger.model!, harness, trigger.demand))
        )
          throw new Error(
            `Trigger ${trigger.id} runs an agent that requires a ${trigger.model} model${trigger.demand?.models ? ` (${trigger.demand.models.join(', ')})` : ''}; configure localModel or agentHarnesses`,
          );
      return {
        service: { triggers, now, newId: options.newId ?? randomUUID },
        start: async (context) => {
          ports = context.ports;
          return [
            startLoop(
              {
                context,
                catalog,
                triggers,
                run: createTriggerRuns(
                  context.application,
                  jobs,
                  harnesses,
                  triggers.values(),
                  () => ports?.eventLog,
                ),
                now,
                cursors: new Map(),
              },
              options.intervalMs ?? 1_000,
            ),
          ];
        },
        describe: () => ({ triggers: [...triggers.keys()] }),
      };
    },
  });
}

function agentHarnesses(options: AutomationOptions, ports: () => HostPorts): Harness[] {
  const local = options.localModel
    ? [
        localHarness({
          ...options.localModel,
          client: () => ports().network.client(LOCAL_INFERENCE_DESTINATION),
        }),
      ]
    : [];
  return [...local, ...(options.agentHarnesses ?? [])];
}
