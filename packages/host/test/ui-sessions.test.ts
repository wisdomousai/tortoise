import { expect, test } from 'bun:test';
import { createUiSessions } from '../src/host/ui-sessions';

const context = { principalId: 'owner', workspaceId: 'w' } as never;
const owner = { token: 't', context } as never;
const sessions = { get: () => ({}) } as never;
/** An application whose tool read returns the record with or without a revision. */
const application = (data: Record<string, unknown>) =>
  ({ queryRaw: async () => ({ data }), catalog: { operations: [] } }) as never;

test('an observed revision is refused when the read returns none', async () => {
  const store = createUiSessions(application({ id: 'a' }), sessions, { tool: 'tool.get' });
  await expect(
    store.register(owner, { selectedResources: ['tool:a'], observedRevisions: { 'tool:a': 7 } }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    store.register(owner, { selectedResources: ['tool:a'], observedRevisions: { 'tool:a': 0 } }),
  ).resolves.toBeDefined();
});

test('an observed revision ahead of the read conflicts', async () => {
  const store = createUiSessions(application({ id: 'a', revision: 2 }), sessions, {
    tool: 'tool.get',
  });
  await expect(
    store.register(owner, { selectedResources: ['tool:a'], observedRevisions: { 'tool:a': 3 } }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    store.register(owner, { selectedResources: ['tool:a'], observedRevisions: { 'tool:a': 2 } }),
  ).resolves.toBeDefined();
});
