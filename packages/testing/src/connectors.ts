import {
  DeliveryUncertain,
  type DeliveryResult,
  type LookupResult,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import type { JsonValue } from '@agent-native/contracts';
import type { Effect } from '@agent-native/runtime';

/**
 * One connector under test, with its target in a fresh state. The suite drives the port as the
 * dispatcher would and asks the harness what the target did; it never inspects the target itself.
 */
export interface ConnectorHarness<Item = unknown> {
  readonly port: SystemOfRecordPort<Item>;
  /** A new effect the target applies. Every call returns a fresh effect ID. */
  accepted(): Effect;
  /** A new effect the target refuses as business data. Every call returns a fresh effect ID. */
  rejected(): Effect;
  /** How many times the target applied `effect`: 0, 1, or more for a duplicate. */
  applied(effect: Effect): Promise<number>;
  /** Make the next delivery fail before it reaches the target, as a dropped connection would. */
  failNext?(): void;
  /** Make the next delivery stop after the target applied it, before the reply arrives. */
  interruptNext?(): void;
  /** Make one new item appear at the target for `pull`. */
  change?(): Promise<void>;
  close?(): Promise<void>;
}

/** A check either passed, or did not apply to this connector, with the reason. Failures throw. */
export type ConformanceResult = { readonly passed: true } | { readonly skipped: string };

/** One named check against a fresh harness. */
export interface ConformanceCase {
  readonly name: string;
  run(): Promise<ConformanceResult>;
}

/**
 * Build an effect for a harness, with the fields a dispatcher hands to a port. Pass
 * `contractVersion` to test a connector that maps payloads recorded by an older release.
 */
export function conformanceEffect(
  fields: Pick<Effect, 'id' | 'target' | 'type'> & {
    payload: JsonValue;
    attempts?: number;
    contractVersion?: string;
  },
): Effect {
  return {
    operation: 'conformance',
    principalId: 'conformance',
    resource: `conformance:${fields.id}`,
    createdAt: 0,
    status: 'pending',
    attempts: 0,
    ...fields,
  };
}

const signal = () => new AbortController().signal;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const settled = (result: DeliveryResult | LookupResult) =>
  result !== undefined && (result.status === 'accepted' || result.status === 'pending');
const retried = (effect: Effect): Effect => ({ ...effect, attempts: effect.attempts + 1 });

/** Deliver as a dispatcher retrying `effect` would: lookup first unless delivery is idempotent. */
async function redeliver(port: SystemOfRecordPort, effect: Effect) {
  const again = retried(effect);
  if (!port.describe().idempotentDelivery) {
    const found = await port.lookup!(again.id, signal(), again);
    if (found !== undefined) return found;
  }
  return port.deliver(again, signal());
}

async function rejects(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the delivery to fail, but it returned');
}

type Setup<Item> = () => Promise<ConnectorHarness<Item>>;

const passed: ConformanceResult = { passed: true };

/** Run `body` against a fresh harness and close it afterwards; `body` may return a skip reason. */
const withHarness =
  <Item>(setup: Setup<Item>, body: (harness: ConnectorHarness<Item>) => Promise<string | void>) =>
  async (): Promise<ConformanceResult> => {
    const harness = await setup();
    try {
      const skipped = await body(harness);
      return skipped ? { skipped } : passed;
    } finally {
      await harness.close?.();
    }
  };

/**
 * The `SystemOfRecordPort` contract as checks any connector can run: a system-of-record client,
 * a screen bridge or a hardware driver. Each case gets a fresh harness from `setup`. A case whose
 * harness hook is missing returns `skipped` with the reason, so a report shows what was not
 * checked. Run them with any test runner: `for (const c of cases) test(c.name, c.run)`.
 */
export function connectorConformance<Item = unknown>(setup: Setup<Item>): ConformanceCase[] {
  const cases: ConformanceCase[] = [
    {
      name: 'describes a target, with a lookup when delivery is not idempotent',
      run: withHarness(setup, async ({ port }) => {
        const description = port.describe();
        check(description.target, 'describe() names no target');
        check(
          description.idempotentDelivery || port.lookup,
          'A target without idempotent delivery must implement lookup',
        );
      }),
    },
    {
      name: 'a delivered effect is applied once, and a retry does not apply it again',
      run: withHarness(setup, async ({ port, accepted, applied }) => {
        const effect = accepted();
        if (port.lookup) {
          const before = await port.lookup(effect.id, signal(), effect);
          check(before === undefined, 'lookup reports an effect that was never delivered');
        }
        const result = await port.deliver(effect, signal());
        check(settled(result), `delivery returned ${JSON.stringify(result)}`);
        check((await applied(effect)) === 1, 'the target did not apply the effect exactly once');
        check(settled(await redeliver(port, effect)), 'a retry did not report the delivery');
        check((await applied(effect)) === 1, 'a retry applied the effect a second time');
      }),
    },
    {
      name: 'a business refusal is returned as data and not applied',
      run: withHarness(setup, async ({ port, rejected, applied }) => {
        const effect = rejected();
        const result = await port.deliver(effect, signal()).catch((error: unknown) => {
          throw new Error(`a refusal threw instead of returning a rejection: ${String(error)}`);
        });
        check(result.status === 'rejected', `a refusal returned ${JSON.stringify(result)}`);
        check(result.code && result.message, 'a rejection needs a code and a message');
        check((await applied(effect)) === 0, 'a refused effect was applied');
      }),
    },
    {
      name: 'a cancelled delivery fails without applying the effect',
      run: withHarness(setup, async ({ port, accepted, applied }) => {
        const effect = accepted();
        const controller = new AbortController();
        controller.abort();
        await rejects(port.deliver(effect, controller.signal));
        check((await applied(effect)) === 0, 'a cancelled delivery applied the effect');
      }),
    },
  ];
  cases.push(transientCase(setup), interruptedCase(setup), pullCase(setup));
  return cases;
}

function transientCase<Item>(setup: Setup<Item>): ConformanceCase {
  const name = 'a transient failure throws, applies nothing, and the retry succeeds';
  return {
    name,
    run: withHarness(setup, async ({ port, accepted, applied, failNext }) => {
      if (!failNext) return 'the harness cannot fail a delivery';
      const effect = accepted();
      failNext();
      const error = await rejects(port.deliver(effect, signal()));
      check(!(error instanceof DeliveryUncertain), 'a failure before the target is not uncertain');
      check((await applied(effect)) === 0, 'a failed delivery applied the effect');
      check(settled(await redeliver(port, effect)), 'the retry after a failure did not deliver');
      check((await applied(effect)) === 1, 'the retry after a failure did not apply it once');
    }),
  };
}

/**
 * The dispatcher may resend only what the port says is safe. After a reply was lost, the port
 * must hold the effect (throw `DeliveryUncertain`, on the first attempt or on the retry) or
 * report the delivery on retry. The dispatcher holds an effect at whichever attempt turns
 * uncertain, so a port that only learns on retry that it may have acted is still safe.
 */
function interruptedCase<Item>(setup: Setup<Item>): ConformanceCase {
  return {
    name: 'a lost reply is held or found again, never applied twice',
    run: withHarness(setup, async ({ port, accepted, applied, interruptNext }) => {
      if (!interruptNext) return 'the harness cannot lose a reply';
      const effect = accepted();
      interruptNext();
      const error = await rejects(port.deliver(effect, signal()));
      if (error instanceof DeliveryUncertain) return;
      const again = await redeliver(port, effect).catch((caught: unknown) => {
        if (caught instanceof DeliveryUncertain) return 'held' as const;
        throw caught;
      });
      check((await applied(effect)) <= 1, 'a lost reply led to a second application');
      if (again === 'held') return;
      check(
        again === undefined || again.status !== 'rejected',
        'a retry after a lost reply was refused',
      );
    }),
  };
}

/** From the last cursor, a pull returns only what changed since, and then nothing. */
function pullCase<Item>(setup: Setup<Item>): ConformanceCase {
  return {
    name: 'pull resumes from its watermark without repeating items',
    run: withHarness(setup, async ({ port, change }) => {
      if (!port.pull || !change) return 'the connector has no pull';
      let cursor: string | undefined;
      for (let page = 0, more = true; more; page++) {
        check(page < 1_000, 'pull kept reporting more items');
        const batch = await port.pull(cursor, signal());
        cursor = batch.cursor;
        more = batch.more ?? false;
      }
      check((await port.pull(cursor, signal())).items.length === 0, 'pull repeated items');
      await change();
      const changed = await port.pull(cursor, signal());
      check(changed.items.length > 0, 'pull missed a change after its watermark');
      check(
        (await port.pull(changed.cursor, signal())).items.length === 0,
        'pull repeated a change',
      );
    }),
  };
}
