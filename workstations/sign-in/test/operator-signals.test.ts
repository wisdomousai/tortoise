import { expect, test } from 'bun:test';
import { OperatorSignals } from '../src/routes';

/** A request under an operator session stops when the operator signs out or the session expires. */
test('an operator session signal aborts at sign-out and at expiry', async () => {
  const signals = new OperatorSignals(Date.now);
  const open = signals.signal('a', Date.now() + 60_000);
  const again = signals.signal('a', Date.now() + 60_000);
  signals.end('a');
  expect(open.aborted).toBe(true);
  expect(again.aborted).toBe(true);
  expect(signals.signal('a', Date.now() + 60_000).aborted).toBe(false);

  const expiring = signals.signal('b', Date.now() + 20);
  expect(expiring.aborted).toBe(false);
  await Bun.sleep(40);
  expect(expiring.aborted).toBe(true);
});
