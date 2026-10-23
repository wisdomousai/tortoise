import { randomUUID } from 'node:crypto';
import { defineHostPlugin } from '@agent-native/host/plugin';
import { resolveWorkflows } from './definitions';
import { workflowsPluginManifest } from './plugin-manifest';
import { startRunner } from './runner';
import {
  createWorkflowsState,
  workflowsHandlers,
  workflowsPolicy,
  type WorkflowsServices,
  type WorkflowsState,
} from './server';

export interface WorkflowsOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/**
 * The workflows plugin. It runs the workflows the application's modules declare with steps:
 * `workflow.start` records an instance, and a serving host's runner advances each one a step at
 * a time as its starter. Nothing advances in an embedded host.
 */
export function createWorkflowsPlugin(options: WorkflowsOptions = {}) {
  const now = options.now ?? Date.now;
  return defineHostPlugin<WorkflowsState, WorkflowsServices>({
    manifest: workflowsPluginManifest,
    state: { create: createWorkflowsState },
    handlers: workflowsHandlers,
    authorization: { resourceTypes: ['workflow'], port: workflowsPolicy },
    async open({ manifest, catalog }) {
      const definitions = resolveWorkflows(manifest.modules, catalog);
      return {
        service: { definitions, now, newId: options.newId ?? randomUUID },
        start: async (context) => [
          startRunner({ context, cursors: new Map() }, options.intervalMs ?? 1_000),
        ],
        describe: () => ({ workflows: [...definitions.keys()] }),
      };
    },
  });
}
