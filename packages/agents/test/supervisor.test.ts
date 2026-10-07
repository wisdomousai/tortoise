import { describe, expect, test } from 'bun:test';
import { createRunSupervisor, MemoryRunStore } from '../src/supervisor';
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

describe('run receipts and terminal states', () => {
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
    // The state is saved before the question event; wait for its durable receipt.
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
  test('restart recovery marks nonterminal receipts interrupted', async () => {
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

test('native completion waits for an outstanding application call receipt', async () => {
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
