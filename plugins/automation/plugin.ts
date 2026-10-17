import { randomUUID } from 'node:crypto';
import type { Harness } from '@agent-native/agents/types';
import { defineHostPlugin } from '@agent-native/host/plugin';
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
  /** The harness agent triggers run with; required when a trigger runs an agent. */
  readonly agentHarness?: Harness;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/**
 * The automation plugin. Triggers are checked against the catalog when it opens; a serving host
 * then runs each trigger that has an active standing grant, as that grant's issuer. Nothing
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
      resourceTypes: ['standing-grant', 'trigger-failure'],
      port: automationPolicy,
    },
    async open({ catalog }) {
      const triggers = resolveTriggers(options.triggers, catalog, jobs);
      if (!options.agentHarness && [...triggers.values()].some((trigger) => 'agent' in trigger.run))
        throw new Error('An agent trigger needs the automation plugin agentHarness option');
      return {
        service: { triggers, now, newId: options.newId ?? randomUUID },
        start: async (context) => [
          startLoop(
            {
              context,
              catalog,
              triggers,
              run: createTriggerRuns(context.application, jobs, options.agentHarness),
              now,
              cursors: new Map(),
            },
            options.intervalMs ?? 1_000,
          ),
        ],
        describe: () => ({ triggers: [...triggers.keys()] }),
      };
    },
  });
}
