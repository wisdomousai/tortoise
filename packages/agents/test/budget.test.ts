import { expect, test } from 'bun:test';
import { createRunSupervisor } from '../src/supervisor';
import { deterministicHarness } from '../src/deterministic';
import type { Harness, HarnessTurn } from '../src/types';

async function completed(supervisor: ReturnType<typeof createRunSupervisor>, id: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const snapshot = (await supervisor.get(id))!;
    if (['succeeded', 'failed', 'cancelled'].includes(snapshot.state)) return snapshot;
    await Bun.sleep(2);
  }
  throw new Error('Run did not complete');
}

test('a run that would exceed its tool call budget fails and makes no further call', async () => {
  const calls: string[] = [];
  const supervisor = createRunSupervisor({
    harnesses: [deterministicHarness],
    tools: { execute: async (operation) => void calls.push(operation) },
  });
  const run = await supervisor.start({
    harnessId: 'deterministic',
    budget: { toolCalls: 2 },
    prompt: JSON.stringify({
      commands: ['a', 'b', 'c'].map((name) => ({ operation: `record.${name}`, input: {} })),
    }),
  });
  const done = await completed(supervisor, run.id);
  expect(done.state).toBe('failed');
  expect(done.failure).toEqual({
    code: 'BUDGET_EXCEEDED',
    message: 'The run used its tool call budget',
  });
  expect(calls).toEqual(['record.a', 'record.b']);
  expect(done.budget).toEqual({ toolCalls: 2 });
});

test('a run past its wall time fails, releasing a question it was waiting on', async () => {
  const waiting: Harness = {
    id: 'waiting',
    features: { questions: true, approvals: true, resume: false },
    availability: async () => ({ available: true }),
    async *run(turn) {
      yield { type: 'text', text: await turn.question('Which lot?') };
    },
  };
  const supervisor = createRunSupervisor({
    harnesses: [waiting],
    tools: { execute: async () => ({}) },
  });
  const run = await supervisor.start({
    harnessId: 'waiting',
    prompt: 'go',
    budget: { wallTimeMs: 30 },
  });
  const done = await completed(supervisor, run.id);
  expect(done.state).toBe('failed');
  expect(done.failure?.code).toBe('BUDGET_EXCEEDED');
  expect(done.failure?.message).toContain('wall time');
});

test('the harness receives the budget, so adapters can stop at the turn limit', async () => {
  let seen: HarnessTurn['budget'];
  const recording: Harness = {
    id: 'recording',
    features: { questions: false, approvals: false, resume: false },
    availability: async () => ({ available: true }),
    async *run(turn) {
      seen = turn.budget;
      yield { type: 'text', text: 'ok' };
    },
  };
  const supervisor = createRunSupervisor({
    harnesses: [recording],
    tools: { execute: async () => ({}) },
  });
  const run = await supervisor.start({
    harnessId: 'recording',
    prompt: 'go',
    budget: { turns: 3 },
  });
  expect((await completed(supervisor, run.id)).state).toBe('succeeded');
  expect(seen).toEqual({ turns: 3 });
});
