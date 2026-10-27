import { afterEach, expect, test } from 'bun:test';
import { owner, startTestRequestsAgents, until } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a run started from the test request screen opens the request and asks for a review of its approval request', async () => {
  const lab = await startTestRequestsAgents();
  close = lab.close;
  const { host } = lab;
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
      operation: 'test-request.submit',
      input: {
        sample: 'OS-24-0804',
        transformer: 'TR-40517',
        description: 'Water content after a gasket leak',
      },
      idempotencyKey: 'submit',
    },
    owner,
  );
  // The test request screen registers the open request; ids are sequential, so it is id-1.
  const ui = (await (
    await call('/api/v1/ui/sessions', {
      selectedResources: ['test-request:id-1'],
      observedRevisions: { 'test-request:id-1': 1 },
    })
  ).json()) as { sessionId: string };

  const tool = (operation: string, input: unknown) => ({ operation, input: { input } });
  expect(
    await run(
      [
        tool('approval.request', {
          operation: 'test-request.update',
          input: { id: 'id-1', method: 'IEC 60814 water content' },
          rationale: 'The test its description names.',
          resource: 'test-request:id-1',
          baseRevisions: { 'test-request:id-1': 1 },
        }),
        tool('ui.open', { resource: 'test-request:id-1' }),
        tool('ui.request-review', {
          title: 'Review the suggested test method',
          operations: ['test-request.update'],
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
    { type: 'openResource', resource: 'test-request:id-1' },
    {
      type: 'requestReview',
      title: 'Review the suggested test method',
      operations: ['test-request.update'],
      resources: ['approval-request:id-2'],
    },
  ]);

  // A missing request, or a kind that is not selectable, is refused and never reaches the screen.
  expect(await run([tool('ui.open', { resource: 'test-request:missing' })], ui.sessionId)).toBe(
    'failed',
  );
  expect(await run([tool('ui.open', { resource: 'work-order:w1' })], ui.sessionId)).toBe('failed');
  expect(await intents()).toHaveLength(2);
});
