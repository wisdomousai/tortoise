import { z } from 'zod';
import { defineWorkflow, from, jsonSchema, step } from '@agent-native/contracts';
import { instanceSchema } from '@agent-native/workflows/contracts';
import { operation } from './operation';
import { recordId } from './schemas';

const WEEK = 7 * 86_400_000;

/**
 * One capture from placement to the EAM: place it, send it to the model to read, wait until a
 * person accepted the values, file the node into the EAM and export it. When the export is
 * refused, the EAM filing is withdrawn.
 */
export const captureToEam = defineWorkflow({
  id: 'survey.capture-to-eam',
  version: 2,
  text: 'Place a capture on its node, send it to the model to read, wait for a reviewer to accept the values, then file the node into the EAM and export it. A refused export withdraws the EAM filing.',
  input: jsonSchema(z.strictObject({ captureId: recordId, nodeId: recordId })),
  maxDurationMs: 2 * WEEK,
  start: 'capture.file-workflow',
  steps: [
    step.run('place', 'assignment.report.place', {
      input: { id: from.input('captureId'), subject: from.input('nodeId') },
    }),
    step.run('extract', 'assignment.extraction.create', {
      input: {
        title: 'Read the capture filed to the EAM',
        scope: { reportId: from.input('captureId') },
        assignee: { type: 'target', id: 'model' },
      },
    }),
    step.wait('reviewed', 'assignment.report.get', {
      input: { id: from.input('captureId') },
      watch: ['assignment-report'],
      until: { equals: [from.result('review'), 'accepted'] },
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
    'Start survey.capture-to-eam for an unplaced capture: it is placed on the node and sent to the model to read, and once a reviewer accepted its values the node is filed into the EAM and exported, as you. One instance per capture runs at a time. Follow it in workflow.list.',
  dependencies: ['assignment-report', 'filing'],
  invokes: ['workflow.start'],
});
