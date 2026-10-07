import { expect, test } from 'bun:test';
import { captureUiContext, UiSessions, type UiContext } from './index';

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

test('session routing, acknowledgement and unavailable frontends stay distinct', async () => {
  const sessions = new UiSessions();
  const received: string[] = [];
  const first = sessions.register(
    { sessionId: 'a', selectedResources: [], observedRevisions: {} },
    async (intent) => {
      received.push(intent.type);
      return 'accepted';
    },
  );
  sessions.register(
    { sessionId: 'b', selectedResources: [], observedRevisions: {} },
    async () => 'rejected',
  );
  expect(await sessions.send('a', { type: 'selectResource', resource: 'task:one' })).toBe(
    'accepted',
  );
  expect(await sessions.send('b', { type: 'openResource', resource: 'task:one' })).toBe('rejected');
  first();
  expect(await sessions.send('a', { type: 'openResource', resource: 'task:one' })).toBe(
    'unavailable',
  );
  expect(received).toEqual(['selectResource']);
});

test('disposing an older registration cannot remove a newer registration for the same session', async () => {
  const sessions = new UiSessions();
  const old = sessions.register(
    { sessionId: 'same', selectedResources: ['task:old'], observedRevisions: {} },
    async () => 'rejected',
  );
  const current = sessions.register(
    { sessionId: 'same', selectedResources: ['task:new'], observedRevisions: {} },
    async () => 'accepted',
  );
  old();
  expect(sessions.capture('same')?.selectedResources).toEqual(['task:new']);
  expect(await sessions.send('same', { type: 'openResource', resource: 'task:new' })).toBe(
    'accepted',
  );
  current();
  expect(sessions.capture('same')).toBeUndefined();
});
