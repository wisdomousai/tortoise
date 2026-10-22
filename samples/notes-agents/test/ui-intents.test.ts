import { afterEach, expect, test } from 'bun:test';
import { owner, startNotesAgents, until } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a run started from the note screen opens the note and asks for a review of its request', async () => {
  const notes = await startNotesAgents();
  close = notes.close;
  const { host } = notes;
  const session = host.sessions.create(owner);
  const call = async (path: string, body?: unknown) =>
    fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const run = async (commands: unknown[], uiSessionId: string) => {
    const started = (await (
      await call('/api/v1/runs', {
        harnessId: 'deterministic',
        prompt: JSON.stringify({ commands }),
        uiSessionId,
      })
    ).json()) as { id: string };
    let state = '';
    await until(async () => {
      state = (await host.supervisor.get(started.id))?.state ?? '';
      return ['succeeded', 'failed', 'cancelled'].includes(state);
    });
    return state;
  };

  await host.application.invokeRaw(
    {
      operation: 'note.add',
      input: { title: '', text: 'Shift handover\nLine 2 restarted' },
      idempotencyKey: 'add',
    },
    owner,
  );
  // The note screen registers the open note; ids are sequential, so the note is id-1.
  const ui = (await (
    await call('/api/v1/ui/sessions', {
      selectedResources: ['note:id-1'],
      observedRevisions: { 'note:id-1': 1 },
    })
  ).json()) as { sessionId: string };

  const tool = (operation: string, input: unknown) => ({ operation, input: { input } });
  expect(
    await run(
      [
        tool('approval.request', {
          operation: 'note.update',
          input: { id: 'id-1', title: 'Shift handover' },
          rationale: 'The first line of the text.',
          resource: 'note:id-1',
          baseRevisions: { 'note:id-1': 1 },
        }),
        tool('ui.open', { resource: 'note:id-1' }),
        tool('ui.request-review', {
          title: 'Review the suggested title',
          operations: ['note.update'],
          resources: ['approval-request:id-2'],
        }),
      ],
      ui.sessionId,
    ),
  ).toBe('succeeded');
  const intents = async () =>
    (await (await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`)).json()) as {
      intent: unknown;
    }[];
  expect((await intents()).map((entry) => entry.intent)).toEqual([
    { type: 'openResource', resource: 'note:id-1' },
    {
      type: 'requestReview',
      title: 'Review the suggested title',
      operations: ['note.update'],
      resources: ['approval-request:id-2'],
    },
  ]);

  // A missing note, or a kind that is not selectable, is refused and never reaches the screen.
  expect(await run([tool('ui.open', { resource: 'note:missing' })], ui.sessionId)).toBe('failed');
  expect(await run([tool('ui.open', { resource: 'task:t1' })], ui.sessionId)).toBe('failed');
  expect(await intents()).toHaveLength(2);
});
