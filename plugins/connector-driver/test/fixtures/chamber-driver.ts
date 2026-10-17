/**
 * A minimal chamber driver as a real child process, for the `driver check` test: it speaks the
 * protocol over stdio and answers with the digest passed as its first argument. It has no
 * actions; `driver check` never invokes one.
 */
import { createInterface } from 'node:readline';

const [digest, flaw] = process.argv.slice(2);
const state = { setpoint: 20, door: flaw === 'ajar' ? 'ajar' : 'closed', control: 'remote' };
const write = (message: object) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

function answer(method: string, params: { fields?: string[] }) {
  switch (method) {
    case 'initialize':
      return {
        driver: { id: 'chamber-script', version: '0.1.0' },
        contract: { digest },
        session: `p${process.pid}`,
        devices: [{ serial: 'CH-0042' }],
      };
    case 'state.read':
      return {
        values: Object.fromEntries(
          (params.fields ?? []).map((field) => [field, state[field as keyof typeof state]]),
        ),
        at: Date.now(),
      };
    case 'action.lookup':
      return { status: 'unknown' };
    case 'health':
    case 'shutdown':
      return {};
    default:
      return undefined;
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line) as { id?: number; method: string; params?: object };
  if (message.id === undefined) return;
  const result = answer(message.method, (message.params ?? {}) as { fields?: string[] });
  if (result === undefined)
    write({
      id: message.id,
      error: { code: -32601, message: 'Method not found', data: { kind: 'rejected' } },
    });
  else write({ id: message.id, result });
  if (message.method === 'shutdown') process.exit(0);
});
