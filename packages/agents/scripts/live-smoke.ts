/** Opt-in transport probe. This file is excluded from ordinary deterministic tests.
 * It sends only a fixed synthetic prompt and a read-only synthetic application tool.
 * It never reads a developer credential file or uses an ambient default model. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { CodexHarness, chatGptCodexOptions } from '../src/codex';
import { ClaudeHarness } from '../src/claude';
import { AiSdkHarness } from '../src/ai-sdk';
import type { Harness, HarnessTurn } from '../src/types';
if (process.env.AGENT_LIVE_ALLOWED !== '1')
  throw new Error(
    'Explicit AGENT_LIVE_ALLOWED=1 is required; this probe sends a synthetic prompt to a provider',
  );
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Explicit ${name} is required`);
  return value;
};
const provider = process.argv[2];
const directory = await mkdtemp(resolve(tmpdir(), 'tortoise-live-'));
await mkdir(resolve(directory, 'home'));
try {
  let harness: Harness;
  if (provider === 'codex')
    harness = new CodexHarness({
      executable: required('TORTOISE_EXECUTABLE'),
      cwd: directory,
      home: resolve(directory, 'home'),
      model: required('AGENT_MODEL'),
      ...chatGptCodexOptions(required('AGENT_ACCESS_TOKEN'), required('AGENT_APP_NAME')),
    });
  else if (provider === 'claude')
    harness = new ClaudeHarness({
      executable: required('TORTOISE_EXECUTABLE'),
      cwd: directory,
      home: resolve(directory, 'home'),
      apiKey: required('AGENT_API_KEY'),
      model: required('AGENT_MODEL'),
    });
  else if (provider === 'ai-sdk')
    harness = new AiSdkHarness({
      model: createOpenAI({ apiKey: required('AGENT_API_KEY') }).responses(required('AGENT_MODEL')),
    });
  else throw new Error('Choose codex, claude or ai-sdk');
  let toolCalls = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Probe timed out')), 90_000);
  const turn: HarnessTurn = {
    runId: 'live-synthetic-probe',
    conversationId: 'live-synthetic-probe',
    prompt:
      'Call the application ping tool once with message "synthetic verification", then report completion.',
    context: {},
    signal: controller.signal,
    tools: {
      definitions: [
        {
          operation: 'app.ping',
          description: 'Return a synthetic pong; no user data or filesystem access',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      ],
      execute: async (operation, _input, context) => {
        context.signal.throwIfAborted();
        if (operation !== 'app.ping') throw new Error('Undeclared tool');
        toolCalls++;
        return { pong: true };
      },
    },
    question: async () => {
      throw new Error('Probe does not answer questions');
    },
    approve: async () => false,
  };
  try {
    for await (const _event of harness.run(turn)) {
      /* Do not print provider text or native IDs. */
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!toolCalls) throw new Error('Provider finished without invoking the application tool');
  process.stdout.write(
    JSON.stringify({ provider, terminal: 'succeeded', toolCalls, synthetic: true }) + '\n',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
