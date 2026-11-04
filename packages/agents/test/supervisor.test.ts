import { describe, expect, test } from 'bun:test';
import { createRunSupervisor, MemoryRunStore, runAuditRecord } from '../src/supervisor';
import { deterministicHarness } from '../src/deterministic';
import type { Harness, RunSnapshot, ToolPort } from '../src/types';
const tools: ToolPort = { execute: async () => ({ ok: true }) };
async function until(
  supervisor: ReturnType<typeof createRunSupervisor>,
  id: string,
  state: string,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = (await supervisor.get(id))!;
    if (snapshot.state === state) return snapshot;
    await Bun.sleep(2);
  }
  throw new Error(`Run did not reach ${state}: ${JSON.stringify(await supervisor.get(id))}`);
}
const harness = (run: Harness['run']): Harness => ({
  id: 'test',
  features: { questions: true, approvals: true, resume: false },
  availability: async () => ({ available: true }),
  run,
});

describe('run command results and terminal states', () => {
  test('fixture tools use captured context, run identity and stable invocation keys', async () => {
    const calls: unknown[] = [];
    const supervisor = createRunSupervisor({
      harnesses: [deterministicHarness],
      tools: {
        execute: async (...args) => {
          calls.push(args);
        },
      },
    });
    const context = { recordId: 'original' };
    const started = await supervisor.start({
      harnessId: 'deterministic',
      context,
      prompt: JSON.stringify({
        commands: [{ operation: 'record.update', input: { name: 'new' } }],
        text: 'done',
      }),
    });
    context.recordId = 'changed';
    const done = await until(supervisor, started.id, 'succeeded');
    expect(done.context.recordId).toBe('original');
    expect((calls[0] as any)[2].idempotencyKey).toBe(`${started.id}:command-0`);
    expect((calls[0] as any)[2].runId).toBe(started.id);
    expect(done.events.map((event) => event.type)).toContain('tool-finish');
  });
  test('partial output never makes a failed run successful and secrets are bounded/redacted', async () => {
    const supervisor = createRunSupervisor({
      harnesses: [deterministicHarness],
      tools,
      redact: ['private-secret'],
      maxOutputChars: 64,
    });
    const run = await supervisor.start({
      harnessId: 'deterministic',
      prompt: JSON.stringify({
        commands: [],
        text: 'private-secret Bearer opaque-value ' + 'x'.repeat(200),
        failAfterText: true,
      }),
    });
    const done = await until(supervisor, run.id, 'failed');
    const text = done.events.find((event) => event.type === 'text')!.text!;
    expect(text.length).toBeLessThanOrEqual(64);
    expect(text).not.toContain('private-secret');
    expect(text).not.toContain('opaque-value');
  });
  test('a secret split across streamed deltas is redacted before persistence and delivery', async () => {
    const store = new MemoryRunStore();
    const supervisor = createRunSupervisor({
      harnesses: [
        harness(async function* () {
          yield { type: 'text', text: 'key sk-test123' };
          yield { type: 'text', text: '456789 then exp' };
          yield { type: 'text', text: 'licit-sec' };
          yield { type: 'text', text: 'ret done' };
          yield { type: 'progress', message: 'after' };
        }),
      ],
      tools,
      store,
      redact: ['explicit-secret'],
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: 'go' });
    const done = await until(supervisor, run.id, 'succeeded');
    const persisted = JSON.stringify(await store.get(run.id));
    for (const leak of ['sk-test123', '456789', 'explicit-secret', 'licit-sec'])
      expect(persisted).not.toContain(leak);
    const text = done.events.flatMap((event) => (event.type === 'text' ? [event.text] : []));
    expect(text.join('')).toBe('key [redacted] then [redacted] done');
    // Held text is released before the next event, so provider order is preserved.
    const order = done.events.map((event) => event.type).filter((type) => type !== 'state');
    expect(order).toEqual([...text.map(() => 'text' as const), 'progress' as const]);
  });
  for (const kind of ['question', 'approval'] as const)
    test(`${kind} times out and closes subscribers`, async () => {
      const supervisor = createRunSupervisor({
        harnesses: [deterministicHarness],
        tools,
        questionTimeoutMs: 20,
      });
      const run = await supervisor.start({
        harnessId: 'deterministic',
        prompt: JSON.stringify({ commands: [], [kind]: 'Continue?' }),
      });
      const events = [];
      for await (const event of supervisor.events(run.id)) events.push(event);
      const done = await supervisor.get(run.id);
      expect(done!.state).toBe('failed');
      expect(done!.failure!.message).toContain('timed out');
      expect(events.some((event) => event.type === kind)).toBe(true);
    });
  test('pending question responses are one use and cancellation blocks subsequent tool work', async () => {
    let calls = 0;
    const supervisor = createRunSupervisor({
      harnesses: [deterministicHarness],
      tools: {
        execute: async () => {
          calls++;
        },
      },
    });
    const run = await supervisor.start({
      harnessId: 'deterministic',
      prompt: JSON.stringify({
        commands: [{ operation: 'write', input: {} }],
        question: 'Continue?',
      }),
    });
    const waiting = await until(supervisor, run.id, 'awaiting-question');
    // The state is saved before the question event; wait for its durable command result.
    let requestId: string | undefined;
    for await (const event of supervisor.events(run.id, waiting.nextSequence - 2))
      if (event.type === 'question') {
        requestId = event.requestId;
        break;
      }
    await supervisor.cancel(run.id);
    await expect(supervisor.respondQuestion(run.id, requestId!, 'yes')).rejects.toThrow(
      'no longer pending',
    );
    expect(calls).toBe(0);
    expect((await supervisor.get(run.id))!.state).toBe('cancelled');
  });
  test('reconnect outside retained history requires a snapshot', async () => {
    const supervisor = createRunSupervisor({
      tools,
      harnesses: [
        harness(async function* () {
          for (let i = 0; i < 300; i++) yield { type: 'progress', message: String(i) };
        }),
      ],
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: '' });
    const done = await until(supervisor, run.id, 'succeeded');
    expect(done.events.length).toBe(256);
    await expect(supervisor.events(run.id, 0)[Symbol.asyncIterator]().next()).rejects.toThrow(
      'cursor expired',
    );
    const events = [];
    for await (const event of supervisor.events(run.id, done.events[0]!.sequence - 1))
      events.push(event);
    expect(events.length).toBe(256);
  });
  test('store failure aborts work, retains honest failed status, and closes live delivery', async () => {
    const base = new MemoryRunStore();
    let writes = 0;
    let toolCalls = 0;
    const supervisor = createRunSupervisor({
      harnesses: [
        harness(async function* (turn) {
          yield { type: 'progress', message: 'before write' };
          await turn.tools.execute('write', {}, { runId: turn.runId, signal: turn.signal });
        }),
      ],
      tools: {
        execute: async () => {
          toolCalls++;
        },
      },
      store: {
        get: (id) => base.get(id),
        list: () => base.list(),
        save: async (snapshot) => {
          if (++writes === 3) throw new Error('disk full');
          await base.save(snapshot);
        },
      },
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: '' });
    let failure: unknown;
    try {
      for await (const _event of supervisor.events(run.id)) {
      }
    } catch (error) {
      failure = error;
    }
    const done = await until(supervisor, run.id, 'failed');
    expect(done.failure!.code).toBe('RUN_STORE_FAILED');
    expect(toolCalls).toBe(0);
    expect(String(failure)).toContain('persistence failed');
    expect((await supervisor.list())[0]!.state).toBe('failed');
  });
  test('duplicate invocation ID executes once and mismatched reuse is rejected', async () => {
    let calls = 0;
    const supervisor = createRunSupervisor({
      tools: { execute: async () => ++calls },
      harnesses: [
        harness(async function* (turn) {
          const context = { runId: turn.runId, signal: turn.signal, idempotencyKey: 'same' };
          expect(await turn.tools.execute('write', { n: 1 }, context)).toBe(1);
          expect(await turn.tools.execute('write', { n: 1 }, context)).toBe(1);
          await turn.tools.execute('write', { n: 2 }, context);
        }),
      ],
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: '' });
    const done = await until(supervisor, run.id, 'failed');
    expect(done.failure!.message).toContain('different arguments');
    expect(calls).toBe(1);
  });
  test('restart recovery marks nonterminal command results interrupted', async () => {
    const store = new MemoryRunStore();
    await store.save({
      id: 'old',
      harnessId: 'test',
      conversationId: 'c',
      state: 'running',
      context: {},
      events: [],
      nextSequence: 1,
      createdAt: '',
      updatedAt: '',
    } satisfies RunSnapshot);
    await createRunSupervisor({ tools, harnesses: [], store }).recoverInterrupted();
    expect((await store.get('old'))!.state).toBe('interrupted');
  });
});

test('native completion waits for an outstanding application call command result', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const supervisor = createRunSupervisor({
    tools: { execute: () => pending },
    harnesses: [
      harness(async function* (turn) {
        void turn.tools.execute('write', {}, { runId: turn.runId, signal: turn.signal });
        yield { type: 'text', text: 'provider finished' };
      }),
    ],
  });
  const run = await supervisor.start({ harnessId: 'test', prompt: '' });
  await Bun.sleep(5);
  expect((await supervisor.get(run.id))!.state).toBe('running');
  finish();
  await until(supervisor, run.id, 'succeeded');
});
test('a failed harness revokes outstanding application work at its commit boundary', async () => {
  let committed = false;
  const supervisor = createRunSupervisor({
    tools: {
      execute: async (_operation, _input, context) => {
        await Bun.sleep(15);
        context.signal.throwIfAborted();
        committed = true;
      },
    },
    harnesses: [
      harness(async function* (turn) {
        void turn.tools
          .execute('write', {}, { runId: turn.runId, signal: turn.signal })
          .catch(() => {});
        yield { type: 'text', text: 'partial' };
        throw new Error('provider failure');
      }),
    ],
  });
  const run = await supervisor.start({ harnessId: 'test', prompt: '' });
  await until(supervisor, run.id, 'failed');
  await Bun.sleep(20);
  expect(committed).toBe(false);
});

test('the observer hears each run start once and end once, with no prompt or output', async () => {
  const heard: [string, string][] = [];
  const records: unknown[] = [];
  const store = new MemoryRunStore();
  await store.save({
    id: 'old',
    harnessId: 'test',
    conversationId: 'c',
    state: 'running',
    context: {},
    events: [],
    nextSequence: 1,
    createdAt: '',
    updatedAt: '',
  } satisfies RunSnapshot);
  const supervisor = createRunSupervisor({
    harnesses: [deterministicHarness],
    tools,
    store,
    onRun(snapshot, change) {
      heard.push([snapshot.id, `${change}:${snapshot.state}`]);
      records.push(runAuditRecord(snapshot, change));
      if (snapshot.id === 'boom') throw new Error('observer failed');
    },
  });
  await supervisor.recoverInterrupted();
  const done = await supervisor.start({
    harnessId: 'deterministic',
    prompt: JSON.stringify({ commands: [], text: 'secret output' }),
    context: { principalId: 'person', workspaceId: 'w' },
  });
  await until(supervisor, done.id, 'succeeded');
  const waiting = await supervisor.start({
    id: 'boom',
    harnessId: 'deterministic',
    prompt: JSON.stringify({ commands: [], question: 'Continue?' }),
  });
  await until(supervisor, waiting.id, 'awaiting-question');
  await supervisor.cancel(waiting.id);
  await Bun.sleep(10);
  expect(heard).toEqual([
    ['old', 'ended:interrupted'],
    [done.id, 'started:queued'],
    [done.id, 'ended:succeeded'],
    ['boom', 'started:queued'],
    ['boom', 'ended:cancelled'],
  ]);
  expect(records[2]).toMatchObject({
    kind: 'run.ended',
    outcome: 'completed',
    actor: { principalId: 'person', workspaceId: 'w', runId: done.id, via: 'harness' },
    data: { harness: 'deterministic', state: 'succeeded' },
  });
  expect(records[0]).toMatchObject({ outcome: 'aborted', reason: 'HOST_RESTARTED' });
  expect(JSON.stringify(records)).not.toContain('secret output');
});

describe('run events for a chat view', () => {
  test('a finished command names the records it changed, and a refusal its code', async () => {
    const supervisor = createRunSupervisor({
      harnesses: [
        harness(async function* (turn) {
          yield { type: 'tool-start', operation: 'quote.create', callId: 'c1' };
          await turn.tools.execute('quote.create', {}, { ...turn, idempotencyKey: 'c1' });
          yield { type: 'tool-finish', operation: 'quote.create', callId: 'c1' };
          yield { type: 'tool-start', operation: 'quote.cancel', callId: 'c2' };
          // A harness that hands the refusal back to its model goes on.
          await turn.tools
            .execute('quote.cancel', {}, { ...turn, idempotencyKey: 'c2' })
            .catch(() => undefined);
          yield { type: 'tool-finish', operation: 'quote.cancel', callId: 'c2' };
        }),
      ],
      tools: {
        execute: async (operation) => {
          if (operation === 'quote.cancel')
            throw Object.assign(new Error('Not in the grant'), { code: 'FORBIDDEN' });
          return { operation, result: {}, revisions: { 'quote:q1': 1 } };
        },
      },
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: 'quote' });
    const done = await until(supervisor, run.id, 'succeeded');
    const finished = done.events.filter((event) => event.type === 'tool-finish');
    expect(finished.map(({ resources, code }) => ({ resources, code }))).toEqual([
      { resources: ['quote:q1'], code: undefined },
      { resources: undefined, code: 'FORBIDDEN' },
    ]);
  });

  test('a reply streamed a token at a time keeps its beginning and the calls before it', async () => {
    const reply = Array.from({ length: 1500 }, (_, index) => `w${index} `);
    const supervisor = createRunSupervisor({
      harnesses: [
        harness(async function* (turn) {
          yield { type: 'tool-start', operation: 'part.list', callId: 'c1' };
          await turn.tools.execute('part.list', {}, { ...turn, idempotencyKey: 'c1' });
          yield { type: 'tool-finish', operation: 'part.list', callId: 'c1' };
          for (const token of reply) yield { type: 'text', text: token };
        }),
      ],
      tools,
    });
    const run = await supervisor.start({ harnessId: 'test', prompt: 'parts' });
    const done = await until(supervisor, run.id, 'succeeded');
    expect(done.events.some((event) => event.type === 'tool-start')).toBe(true);
    expect(
      done.events
        .filter((event) => event.type === 'text')
        .map((event) => event.text)
        .join(''),
    ).toBe(reply.join(''));
  });
});
