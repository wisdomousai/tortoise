import { expect, test } from 'bun:test';
import { captureUiContext, type UiContext } from './index';

test('captured UI targets remain independent of later selection/revision changes', () => {
  const context: UiContext = {
    sessionId: 'front-one',
    selectedResources: ['task:one'],
    observedRevisions: { 'task:one': 2 },
  };
  const captured = captureUiContext(context);
  (context.selectedResources as string[])[0] = 'task:two';
  (context.observedRevisions as Record<string, number>)['task:one'] = 99;
  expect(captured).toEqual({
    sessionId: 'front-one',
    selectedResources: ['task:one'],
    observedRevisions: { 'task:one': 2 },
  });
});
