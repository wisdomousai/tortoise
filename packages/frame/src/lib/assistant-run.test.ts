import { expect, test } from 'bun:test';
import { approvalRequestOf, conversationRuns, runItems, type PanelRun } from './assistant-run';

const run = (fields: Partial<PanelRun>): PanelRun => ({
  id: 'r1',
  state: 'succeeded',
  conversationId: 'c1',
  createdAt: '2026-11-04T10:00:00.000Z',
  events: [],
  ...fields,
});

test('a run reads as joined text, settled calls and answered requests in order', () => {
  const items = runItems(
    run({
      events: [
        { sequence: 1, type: 'text', text: 'Looking ' },
        { sequence: 2, type: 'text', text: 'it up.', at: '2026-11-04T10:00:01.000Z' },
        { sequence: 3, type: 'tool-start', operation: 'quote.get', callId: 'a' },
        { sequence: 4, type: 'question', requestId: 'q', message: 'Which?', choices: ['A', 'B'] },
        { sequence: 5, type: 'answer', requestId: 'q', text: 'B' },
        { sequence: 6, type: 'tool-finish', operation: 'quote.get', callId: 'a' },
        { sequence: 7, type: 'tool-start', operation: 'approval.request', callId: 'b' },
        {
          sequence: 8,
          type: 'tool-finish',
          operation: 'approval.request',
          callId: 'b',
          resources: ['approval-request:x1'],
        },
        { sequence: 9, type: 'approval', requestId: 'p', message: 'Go on?' },
        { sequence: 10, type: 'answer', requestId: 'p', approved: false },
      ],
    }),
  );
  expect(items).toEqual([
    { kind: 'text', text: 'Looking it up.', at: '2026-11-04T10:00:01.000Z' },
    { kind: 'call', callId: 'a', operation: 'quote.get', state: 'finished', resources: [] },
    {
      kind: 'question',
      requestId: 'q',
      message: 'Which?',
      choices: ['A', 'B'],
      open: false,
      answer: 'B',
    },
    {
      kind: 'call',
      callId: 'b',
      operation: 'approval.request',
      state: 'finished',
      resources: ['approval-request:x1'],
    },
    {
      kind: 'approval',
      requestId: 'p',
      message: 'Go on?',
      choices: [],
      open: false,
      approved: false,
    },
  ]);
  expect(approvalRequestOf(items[3] as never)).toBe('approval-request:x1');
});

test('only the last request of a waiting run is open', () => {
  const waiting = run({
    state: 'awaiting-question',
    events: [{ sequence: 1, type: 'question', requestId: 'q', message: 'Which?' }],
  });
  expect(runItems(waiting)[0]).toMatchObject({ open: true });
  expect(runItems({ ...waiting, state: 'running' })[0]).toMatchObject({ open: false });
});

test('a refused call carries its code, and a conversation lists its runs in start order', () => {
  expect(
    runItems(
      run({
        events: [
          {
            sequence: 1,
            type: 'tool-finish',
            operation: 'quote.cancel',
            callId: 'c',
            code: 'FORBIDDEN',
          },
        ],
      }),
    )[0],
  ).toMatchObject({ state: 'refused', code: 'FORBIDDEN' });
  const later = run({ id: 'r2', createdAt: '2026-11-04T10:05:00.000Z' });
  const other = run({ id: 'r3', conversationId: 'c2' });
  expect(conversationRuns([later, other, run({})], 'c1').map((entry) => entry.id)).toEqual([
    'r1',
    'r2',
  ]);
  expect(conversationRuns([later], undefined)).toEqual([]);
});
