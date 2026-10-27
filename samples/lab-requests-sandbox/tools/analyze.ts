// The result analyst's tool. It runs inside the analysis sandbox and reaches the host only
// through the application CLI, run in this process with the connection file the sandbox
// provides. That file holds the run's token, so every call acts as the person who started the
// run, narrowed to the analyst's grant. It prints one JSON line: the analysis, or the step that failed.
import { readConnection, runCli } from '@agent-native/adapters/cli';
import { createHttpTransport } from '@agent-native/client';
import { errorEnvelope } from '@agent-native/contracts';
import { summarize } from './statistics';

const [id] = process.argv.slice(2);
const print = (value: unknown) => console.log(JSON.stringify(value));
if (!id) {
  print({ error: { code: 'INVALID_INPUT', message: 'Usage: bun analyze.ts <result id>' } });
  process.exit(2);
}

const { endpoint, token } = await readConnection();
const client = createHttpTransport({ baseUrl: endpoint, token });

/** One CLI call, as `cli <words>` makes it: the value it returns, or its error envelope. */
async function call(...words: string[]) {
  try {
    return { ok: true as const, out: (await runCli(words, client)) as any };
  } catch (error) {
    return { ok: false as const, error: errorEnvelope(error) };
  }
}

const read = await call('test-result', 'get', '--id', id);
if (!read.ok) {
  print({ step: 'read', error: read.error });
  process.exit(1);
}
const analysis = summarize(read.out.data.readings);
const recorded = await call(
  'test-result',
  'analyze',
  '--json',
  JSON.stringify({ id, ...analysis }),
);
if (!recorded.ok) {
  print({ step: 'record', error: recorded.error });
  process.exit(1);
}
print({ analysis, revisions: recorded.out.revisions });
