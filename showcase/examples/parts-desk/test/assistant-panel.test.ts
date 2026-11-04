import { expect, test } from 'bun:test';
import {
  notesByCall,
  recordNames,
  runItems,
  type PanelEvent,
  type UiNote,
} from '../ui/assistant-run';
import { draftFromPrepared, preparedQuote, type QuoteDraft } from '../ui/quote-drafts';

// What the assistant panel shows, without a browser: the items of a run. The browser test (`e2e/assistant.pw.ts`) shows them in the panel.

const event = (sequence: number, fields: Omit<PanelEvent, 'sequence'>): PanelEvent => ({
  sequence,
  ...fields,
});

test('a run shows its calls by callId, its text joined and the question it waits for', () => {
  const events = [
    event(1, { type: 'state', at: '2026-11-03T10:00:00.000Z' }),
    event(2, { type: 'tool-start', operation: 'transformer.find', callId: 'a' }),
    event(3, { type: 'tool-finish', operation: 'transformer.find', callId: 'a' }),
    event(4, { type: 'tool-start', operation: 'quote.discount', callId: 'b' }),
    event(5, { type: 'tool-finish', operation: 'quote.discount', callId: 'b', code: 'FORBIDDEN' }),
    event(6, { type: 'tool-start', operation: 'quote.create', callId: 'c' }),
    event(7, {
      type: 'tool-finish',
      operation: 'quote.create',
      callId: 'c',
      resources: ['quote:q1'],
    }),
    event(8, { type: 'text', text: 'TR-404 matches ', at: '2026-11-03T10:00:01.000Z' }),
    event(9, { type: 'text', text: 'two.', at: '2026-11-03T10:00:02.000Z' }),
    event(10, { type: 'question', requestId: 'r1', message: 'Which?', choices: ['TR-40417'] }),
    event(11, { type: 'tool-start', operation: 'part.search', callId: 'd' }),
  ];
  const run = { id: 'run', conversationId: 'run', state: 'awaiting-question', events };
  expect(runItems(run)).toEqual([
    {
      kind: 'call',
      callId: 'a',
      operation: 'transformer.find',
      state: 'finished',
      resources: [],
    },
    {
      kind: 'call',
      callId: 'b',
      operation: 'quote.discount',
      state: 'refused',
      code: 'FORBIDDEN',
      resources: [],
    },
    {
      kind: 'call',
      callId: 'c',
      operation: 'quote.create',
      state: 'finished',
      resources: ['quote:q1'],
    },
    { kind: 'text', text: 'TR-404 matches two.', at: '2026-11-03T10:00:02.000Z' },
    { kind: 'question', requestId: 'r1', message: 'Which?', choices: ['TR-40417'], open: true },
    { kind: 'call', callId: 'd', operation: 'part.search', state: 'running', resources: [] },
  ]);
  // Once the run goes on, the question is no longer open.
  expect(runItems({ ...run, state: 'running' })[4]).toMatchObject({ open: false });
});

test('serials and quote numbers in the text are named for links', () => {
  expect(recordNames('TR-40417 is on Q-00003, not TR-404.')).toEqual([
    { text: 'TR-40417', record: 'transformer' },
    { text: ' is on ' },
    { text: 'Q-00003', record: 'quote' },
    { text: ', not TR-404.' },
  ]);
});

test("each UI call takes what the panel's handler noted for its run, in the order of the calls", () => {
  const events = [
    event(1, { type: 'tool-start', operation: 'ui.open', callId: 'a' }),
    event(2, { type: 'tool-finish', operation: 'ui.open', callId: 'a' }),
    // A refused call queued no intent, so it takes no note.
    event(3, { type: 'tool-start', operation: 'ui.open', callId: 'b' }),
    event(4, { type: 'tool-finish', operation: 'ui.open', callId: 'b', code: 'FORBIDDEN' }),
    event(5, { type: 'tool-start', operation: 'ui.prepare', callId: 'c' }),
    event(6, { type: 'tool-finish', operation: 'ui.prepare', callId: 'c' }),
    event(7, { type: 'tool-start', operation: 'ui.open', callId: 'd' }),
  ];
  const run = { id: 'run-2', conversationId: 'run-1', state: 'running', events };
  const note = (fields: Partial<UiNote> & Pick<UiNote, 'tool' | 'name'>): UiNote => ({
    runId: 'run-2',
    accepted: true,
    ...fields,
  });
  const notes = [
    note({ runId: 'run-1', tool: 'ui.open', name: 'Q-00001' }),
    note({ tool: 'ui.open', name: 'TR-40417' }),
    note({ tool: 'ui.prepare', name: 'TR-40417', operation: 'quote.create', lines: 1 }),
  ];
  const byCall = notesByCall(run, notes);
  expect(byCall.get('a')?.name).toBe('TR-40417');
  expect(byCall.has('b')).toBe(false);
  expect(byCall.get('c')).toMatchObject({ operation: 'quote.create', lines: 1 });
  // The second open is still running and its intent has not arrived yet.
  expect(byCall.has('d')).toBe(false);
});

test('a prepared quote.create fills the builder with the prices of the parts that fit, and leaves out the rest', () => {
  expect(preparedQuote({ transformerSerial: 'TR-404', lines: [] })).toBeUndefined();
  expect(
    preparedQuote({ transformerSerial: 'TR-40417', lines: [{ partNumber: 'BSH-145-1250' }] }),
  ).toBeUndefined();
  const prepared = preparedQuote({
    customerId: 'c1',
    transformerSerial: 'tr-40417',
    inquiryId: 'i1',
    lines: [
      { partNumber: 'bsh-145-1250', quantity: 2 },
      { partNumber: 'BSH-245-1600', quantity: 1 },
      { partNumber: 'BSH-145-1250', quantity: 120 },
    ],
  })!;
  expect(prepared.serial).toBe('TR-40417');
  const start: QuoteDraft = {
    serial: 'TR-40417',
    customerId: 'c1',
    lines: [],
    percent: 0,
    reason: '',
  };
  const parts = [
    {
      partNumber: 'BSH-145-1250',
      description: 'HV bushing 145 kV 1250 A, OIP',
      unitPrice: 1_480_000,
    },
  ];
  expect(draftFromPrepared(prepared, start, parts, 'p1')).toEqual({
    draft: {
      ...start,
      inquiryId: 'i1',
      preparedId: 'p1',
      // Named twice, the part takes one line, at most 99.
      lines: [{ ...parts[0]!, quantity: 99 }],
    },
    left: ['BSH-245-1600'],
  });
});
