import { randomUUID } from 'node:crypto';
import { stateValueFits, type DriverContract } from '../contracts/define';
import { DriverError, lookupAnswer, stateAnswer } from '../protocol';
import {
  driverContractDigest,
  openSession,
  type DriverProcess,
  type DriverSession,
} from '../supervisor/session';

/** One check against a driver executable. `detail` is caller-safe text. */
export interface DriverCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface DriverCheckOptions {
  readonly contract: DriverContract;
  readonly start: () => Promise<DriverProcess>;
  /** Per request; the handshake and shutdown get the same budget. Default 10 s. */
  readonly timeoutMs?: number;
}

const message = (error: unknown) =>
  error instanceof DriverError ? error.message : 'the driver failed without a classified error';

async function attempt(name: string, run: () => Promise<string | undefined>): Promise<DriverCheck> {
  try {
    const problem = await run();
    return problem ? { name, passed: false, detail: problem } : { name, passed: true };
  } catch (error) {
    return { name, passed: false, detail: message(error) };
  }
}

/** Every declared field is answered, and each value fits its declaration. */
async function stateRead(session: DriverSession, contract: DriverContract, timeoutMs: number) {
  const fields = Object.keys(contract.state);
  const parsed = stateAnswer.safeParse(
    await session.rpc.request('state.read', { fields }, { timeoutMs }),
  );
  if (!parsed.success) return 'state.read answered invalidly';
  const missing = fields.filter((field) => !(field in parsed.data.values));
  if (missing.length) return `state.read left out ${missing.join(', ')}`;
  const misfit = fields.filter(
    (field) => !stateValueFits(contract.state[field]!, parsed.data.values[field]!),
  );
  return misfit.length ? `values do not fit their declaration: ${misfit.join(', ')}` : undefined;
}

/** A lookup of an effect the driver never saw answers `unknown`. */
async function lookupUnknown(session: DriverSession, timeoutMs: number) {
  const parsed = lookupAnswer.safeParse(
    await session.rpc.request(
      'action.lookup',
      { effectId: `check-${randomUUID()}` },
      { timeoutMs },
    ),
  );
  if (!parsed.success) return 'action.lookup answered invalidly';
  return parsed.data.status === 'unknown'
    ? undefined
    : `an unseen effect was looked up as ${parsed.data.status}`;
}

/**
 * Shutdown is answered and the process exits by itself with code 0, before the host has to stop
 * it. The host keeps stdin open, so a driver that crashes while its reader is blocked on stdin
 * (an abort at interpreter shutdown, say) fails here.
 */
async function shutdown(session: DriverSession, timeoutMs: number) {
  await session.rpc.request('shutdown', {}, { timeoutMs });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    session.exited,
    new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), timeoutMs))),
  ]);
  clearTimeout(timer);
  if (!exited) return 'the driver did not exit after shutdown';
  return exited.code === 0
    ? undefined
    : `the driver exited with ${exited.signal ?? `code ${exited.code}`} after shutdown`;
}

/**
 * Check a driver executable against its contract without acting on equipment: the handshake and
 * digest, a read of every state field, health, a lookup of an unseen effect (when the contract
 * declares lookup), a refused unknown method, and a clean exit after shutdown. It never sends
 * `action.invoke`, so it is safe to run against a connected unit. Protocol problems seen along
 * the way (malformed lines, invalid notifications) fail their own check.
 */
export async function checkDriver(options: DriverCheckOptions): Promise<readonly DriverCheck[]> {
  const { contract } = options;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const problems: string[] = [];
  let session: DriverSession;
  try {
    session = await openSession(await options.start(), {
      contract,
      digest: driverContractDigest(contract),
      mode: 'monitor-only',
      handshakeMs: timeoutMs,
      onEvent: () => undefined,
      onProblem: (problem) => problems.push(problem),
    });
  } catch (error) {
    return [{ name: 'handshake', passed: false, detail: message(error) }];
  }
  const checks: DriverCheck[] = [
    {
      name: 'handshake',
      passed: true,
      detail: `${session.hello.driver.id} ${session.hello.driver.version}, ${session.hello.devices.length} unit(s)`,
    },
    await attempt('state.read', () => stateRead(session, contract, timeoutMs)),
    await attempt('health', async () => {
      await session.rpc.request('health', {}, { timeoutMs });
      return undefined;
    }),
  ];
  if (contract.lookup)
    checks.push(await attempt('action.lookup', () => lookupUnknown(session, timeoutMs)));
  checks.push(
    await attempt('unknown method', async () => {
      const answered = await session.rpc
        .request('check.unknown', {}, { timeoutMs })
        .then(() => true)
        .catch((error: unknown) => !(error instanceof DriverError) || error.kind === 'timeout');
      return answered ? 'an unknown method was not refused' : undefined;
    }),
    await attempt('shutdown', () => shutdown(session, timeoutMs)),
  );
  session.process.terminate();
  checks.push(
    problems.length
      ? { name: 'protocol', passed: false, detail: problems.slice(0, 5).join('; ') }
      : { name: 'protocol', passed: true },
  );
  return checks;
}
