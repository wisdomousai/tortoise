import { z } from 'zod';
import { defineWorkflow, from, jsonSchema, step } from '@agent-native/contracts';
import { instanceSchema } from '@agent-native/workflows/contracts';
import { operation } from './operation';
import { recordId } from './schemas';

const WEEK = 7 * 86_400_000;

/**
 * One capture from placement to the EAM: place it, request its extraction, wait until a person
 * accepted the values, file the node into the EAM and export it. When the export is refused, the
 * EAM filing is withdrawn.
 */
export const captureToEam = defineWorkflow({
  id: 'survey.capture-to-eam',
  version: 1,
  text: 'Place a capture on its node, request its extraction, wait for a reviewer to accept the values, then file the node into the EAM and export it. A refused export withdraws the EAM filing.',
  input: jsonSchema(z.strictObject({ captureId: recordId, nodeId: recordId })),
  maxDurationMs: 2 * WEEK,
  start: 'capture.file-workflow',
  steps: [
    step.run('place', 'capture.place', {
      input: { id: from.input('captureId'), nodeId: from.input('nodeId') },
    }),
    step.run('extract', 'extraction.request', { input: { captureId: from.input('captureId') } }),
    step.wait('reviewed', 'capture.get', {
      input: { id: from.input('captureId') },
      watch: ['capture'],
      until: { equals: [from.result('review'), 'reviewed'] },
      timeoutMs: WEEK,
    }),
    step.run('file', 'filing.file', {
      input: { nodeId: from.input('nodeId') },
      await: 'effects',
      compensate: { command: 'filing.withdraw', input: { id: from.step('file', 'id') } },
    }),
    step.run('export', 'filing.export', {
      input: { nodeId: from.input('nodeId') },
      await: 'effects',
    }),
  ],
});

export const captureFileWorkflow = operation('capture.file-workflow', 'command', {
  input: z.strictObject({ id: recordId, nodeId: recordId }),
  output: instanceSchema,
  permission: { action: 'file', resourceType: 'Filing' },
  description:
    'Start survey.capture-to-eam for an unplaced capture: it is placed on the node and sent for extraction, and once a reviewer accepted its values the node is filed into the EAM and exported, as you. One instance per capture runs at a time. Follow it in workflow.list.',
  dependencies: ['capture', 'filing'],
  invokes: ['workflow.start'],
});
