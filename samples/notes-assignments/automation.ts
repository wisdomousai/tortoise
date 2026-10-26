import type { Harness } from '@agent-native/agents/types';
import { offerEventType } from '@agent-native/assignments';
import { defineTrigger } from '@agent-native/automation/contracts';
import { createAutomationPlugin } from '@agent-native/automation/plugin';
import { assignmentOperations, reviewer } from './contracts';
import { ruleReviewer } from './reviewer';

/**
 * When a review is sent to the reviewer agent, start a run of it on that assignment. It runs as
 * the person who enabled the trigger, narrowed to the agent's operations and to the assignment.
 */
export const reviewSentToAgent = defineTrigger({
  id: 'review-sent-to-agent',
  title: 'Run the reviewer on reviews sent to it',
  on: {
    event: {
      resourceType: 'assignment',
      operations: [assignmentOperations.reviewCreate.id, assignmentOperations.reviewSend.id],
      types: [offerEventType(reviewer.id)],
    },
  },
  run: { agent: reviewer.id },
  prompt: 'A note review was sent to you. Review the notes in it.',
});

export const createReviewAutomation = (
  options: { intervalMs?: number; harnesses?: readonly Harness[] } = {},
) =>
  createAutomationPlugin({
    triggers: [reviewSentToAgent],
    agentHarnesses: options.harnesses ?? [ruleReviewer],
    ...(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
  });
