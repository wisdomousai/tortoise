import { describe, expect, test } from 'bun:test';
import {
  DeliveryFailure,
  type DeliveryResult,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import type { Effect } from '@agent-native/runtime';
import { conformanceEffect, connectorConformance, type ConnectorHarness } from '../src/connectors';

interface Flaws {
  /** Claims idempotent delivery but ignores the effect ID, so a retry creates a second record. */
  readonly duplicates?: boolean;
  /** Throws on a business refusal instead of returning it. */
  readonly throwsRefusals?: boolean;
  /** Ignores the abort signal. */
  readonly ignoresAbort?: boolean;
}

/** A target that keys records by effect ID, with an optional flaw to show the suite catches it. */
function harness(flaws: Flaws = {}): ConnectorHarness<string> {
  const records: string[] = [];
  const items: string[] = ['a', 'b', 'c'];
  let next = 0;
  let fail = false;
  let interrupt = false;
  const outcome = (effect: Effect): DeliveryResult => ({
    status: 'accepted',
    externalRef: `rec-${effect.id}`,
  });
  const port: SystemOfRecordPort<string> = {
    describe: () => ({ target: 'fake', idempotentDelivery: true }),
    async deliver(effect, signal) {
      if (!flaws.ignoresAbort) signal.throwIfAborted();
      if (fail) throw ((fail = false), new DeliveryFailure('Connection dropped'));
      if ((effect.payload as { refuse?: boolean }).refuse) {
        if (flaws.throwsRefusals) throw new DeliveryFailure('Refused');
        return { status: 'rejected', code: 'INVALID', message: 'Refused by the target' };
      }
      if (flaws.duplicates || !records.includes(effect.id)) records.push(effect.id);
      if (interrupt) throw ((interrupt = false), new Error('Reply lost'));
      return outcome(effect);
    },
    async lookup(effectId) {
      return records.includes(effectId)
        ? { status: 'accepted', externalRef: `rec-${effectId}` }
        : undefined;
    },
    async pull(cursor) {
      const from = cursor === undefined ? 0 : Number(cursor);
      const page = items.slice(from, from + 2);
      return {
        items: page,
        cursor: String(from + page.length),
        more: from + page.length < items.length,
      };
    },
  };
  const effect = (payload: { refuse?: boolean }) =>
    conformanceEffect({ id: `e${++next}`, target: 'fake', type: 'record.create', payload });
  return {
    port,
    accepted: () => effect({}),
    rejected: () => effect({ refuse: true }),
    applied: async (target) => records.filter((id) => id === target.id).length,
    failNext: () => void (fail = true),
    interruptNext: () => void (interrupt = true),
    change: async () => void items.push(`item-${items.length}`),
  };
}

describe('a conforming connector', () => {
  for (const check of connectorConformance(async () => harness()))
    test(check.name, async () => expect(await check.run()).toEqual({ passed: true }));
});

test('a harness without failure hooks reports those checks as skipped', async () => {
  const { failNext: _f, interruptNext: _i, change: _c, ...bare } = harness();
  const results = await Promise.all(
    connectorConformance(async () => bare).map(async (check) => [check.name, await check.run()]),
  );
  expect(results.filter(([, result]) => 'skipped' in (result as object))).toHaveLength(3);
});

test.each([
  ['duplicates', 'applied the effect a second time'],
  ['throwsRefusals', 'a refusal threw instead of returning a rejection'],
  ['ignoresAbort', 'Expected the delivery to fail'],
] as const)('a connector that %s fails conformance', async (flaw, message) => {
  const failures: string[] = [];
  for (const check of connectorConformance(async () => harness({ [flaw]: true })))
    await check.run().catch((error: Error) => failures.push(error.message));
  expect(failures.join('\n')).toContain(message);
});

test('a conformance effect carries the contract version it was recorded under', () => {
  const effect = conformanceEffect({
    id: 'e1',
    target: 'fake',
    type: 'record.create',
    payload: {},
    contractVersion: '1',
  });
  expect(effect).toMatchObject({ contractVersion: '1', attempts: 0, status: 'pending' });
});
