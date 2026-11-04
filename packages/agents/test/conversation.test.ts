import { expect, test } from 'bun:test';
import { conversationMessages } from '../src/ai-sdk';
import { createRunSupervisor } from '../src/supervisor';
import { MAX_EARLIER_CHARS } from '../src/supervisor/conversation';
import type { Harness, HarnessTurn } from '../src/types';

const tools = { execute: async () => ({}) };
async function ended(supervisor: ReturnType<typeof createRunSupervisor>, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = (await supervisor.get(id))!;
    if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
    await Bun.sleep(2);
  }
  throw new Error(`Run ${id} did not end`);
}

/** A harness that replies with a fixed text and records each turn it ran. */
function echo(resume: boolean, turns: HarnessTurn[] = []): Harness & { turns: HarnessTurn[] } {
  return {
    id: resume ? 'resumes' : 'forgets',
    features: { questions: true, approvals: true, resume },
    turns,
    availability: async () => ({ available: true }),
    async *run(turn) {
      turns.push(turn);
      if (turn.prompt === 'ask') {
        const answer = await turn.question('Which line?', ['A', 'B']);
        yield { type: 'text', text: `line ${answer}` };
        return;
      }
      yield { type: 'text', text: `reply to ${turn.prompt}` };
    },
  };
}

test('a run keeps the scrubbed request, and a harness that cannot resume gets the earlier turns', async () => {
  const forgets = echo(false);
  const supervisor = createRunSupervisor({ harnesses: [forgets], tools, redact: ['hunter2'] });
  const first = await supervisor.start({
    harnessId: 'forgets',
    prompt: 'instructions\n\nfirst',
    request: 'first, password hunter2',
  });
  await ended(supervisor, first.id);
  expect((await supervisor.get(first.id))!.request).toBe('first, password [redacted]');
  const second = await supervisor.start({
    harnessId: 'forgets',
    prompt: 'instructions\n\nsecond',
    request: 'second',
    conversationId: first.conversationId,
  });
  await ended(supervisor, second.id);
  expect(forgets.turns[0]!.earlier).toBeUndefined();
  expect(forgets.turns[1]!.earlier).toEqual([
    { request: 'first, password [redacted]', reply: 'reply to instructions\n\nfirst' },
  ]);
});

test('a harness that resumes its session gets no earlier turns', async () => {
  const resumes = echo(true);
  const supervisor = createRunSupervisor({ harnesses: [resumes], tools });
  const first = await supervisor.start({ harnessId: 'resumes', prompt: 'one', request: 'one' });
  await ended(supervisor, first.id);
  const second = await supervisor.start({
    harnessId: 'resumes',
    prompt: 'two',
    request: 'two',
    conversationId: first.conversationId,
  });
  await ended(supervisor, second.id);
  expect(resumes.turns[1]!.earlier).toBeUndefined();
});

test('the oldest turns are left out first once the earlier turns grow too long', async () => {
  const forgets = echo(false);
  const supervisor = createRunSupervisor({ harnesses: [forgets], tools });
  const long = 'x'.repeat(MAX_EARLIER_CHARS / 2);
  let conversationId: string | undefined;
  for (const request of [`a${long}`, `b${long}`, 'c']) {
    const run = await supervisor.start({
      harnessId: 'forgets',
      prompt: request.slice(0, 1),
      request,
      ...(conversationId ? { conversationId } : {}),
    });
    conversationId ??= run.conversationId;
    await ended(supervisor, run.id);
  }
  expect(forgets.turns[2]!.earlier!.map((turn) => turn.request[0])).toEqual(['b']);
});

test('the answer to a question is kept as an event of the run', async () => {
  const supervisor = createRunSupervisor({ harnesses: [echo(false)], tools });
  const run = await supervisor.start({ harnessId: 'forgets', prompt: 'ask', request: 'ask' });
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await supervisor.get(run.id))!.state === 'awaiting-question') break;
    await Bun.sleep(2);
  }
  const question = (await supervisor.get(run.id))!.events.find(
    (event) => event.type === 'question',
  )!;
  await supervisor.respondQuestion(run.id, question.requestId!, 'B');
  const done = await ended(supervisor, run.id);
  expect(done.events.find((event) => event.type === 'answer')).toMatchObject({
    requestId: question.requestId,
    text: 'B',
  });
});

test('earlier turns become chat messages before the prompt', () => {
  expect(
    conversationMessages(
      [
        { request: 'Which transformer?', reply: 'TR-40417.' },
        { request: 'Open it', reply: '' },
      ],
      'Its bushings?',
    ),
  ).toEqual([
    { role: 'user', content: 'Which transformer?' },
    { role: 'assistant', content: 'TR-40417.' },
    { role: 'user', content: 'Open it' },
    { role: 'assistant', content: '(no text)' },
    { role: 'user', content: 'Its bushings?' },
  ]);
});
