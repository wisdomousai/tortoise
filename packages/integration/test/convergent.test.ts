import { expect, test } from 'bun:test';
import type { Effect } from '@tortoise/runtime';
import {
  AttemptMemory,
  DeliveryFailure,
  DeliveryUncertain,
  confirm,
  deliverConvergent,
  interruption,
  lookupConvergent,
  waitFor,
  type ConditionCheck,
  type ReadClock,
} from '../src/index';

/** A setpoint on an instrument: the state the effect wants and what the instrument reads back. */
interface View {
  readonly mode: 'local' | 'remote';
  readonly setpoint: number | null;
  readonly door: 'closed' | 'open';
}

function instrument(initial: View) {
  let current = initial;
  let now = 0;
  const reads: View[] = [];
  const clock: ReadClock = { now: () => now, sleep: async (ms) => void (now += ms), pollMs: 10 };
  const observe = async () => (reads.push(current), current);
  const check =
    (want: number) =>
    (view: View): ConditionCheck =>
      view.setpoint === null
        ? { met: false, unmet: [], unknown: ['setpoint'] }
        : {
            met: view.setpoint === want,
            unmet: view.setpoint === want ? [] : ['setpoint'],
            unknown: [],
          };
  const set = (next: Partial<View>) => (current = { ...current, ...next });
  return { clock, observe, check, set, reads };
}

const delivery = (target: ReturnType<typeof instrument>, want: number, acts: number[]) => ({
  title: 'Set the setpoint',
  observe: target.observe,
  converged: (first: View, signal: AbortSignal) =>
    confirm(target.clock, target.observe, target.check(want), 2, first, signal),
  accepted: (view: View) => ({ status: 'accepted' as const, externalRef: `read:${view.setpoint}` }),
  notReady: (view: View) =>
    view.mode === 'remote' ? undefined : 'The instrument is in local mode',
  preconditions: (first: View, signal: AbortSignal) =>
    confirm(
      target.clock,
      target.observe,
      (view) =>
        view.door === 'closed'
          ? { met: true, unmet: [], unknown: [] }
          : { met: false, unmet: ['door is open'], unknown: [] },
      1,
      first,
      signal,
    ),
  act: async (view: View) => {
    acts.push(want);
    target.set({ setpoint: want });
    return { status: 'accepted' as const, externalRef: `read:${want}` };
  },
});
const signal = new AbortController().signal;

test('a target that already shows the state is accepted without acting, after stable reads', async () => {
  const target = instrument({ mode: 'remote', setpoint: 40, door: 'closed' });
  const acts: number[] = [];
  expect(await deliverConvergent(delivery(target, 40, acts), signal)).toEqual({
    status: 'accepted',
    externalRef: 'read:40',
  });
  expect(acts).toEqual([]);
  expect(target.reads).toHaveLength(2);
});

test('not ready fails transiently, unmet preconditions reject, met ones act', async () => {
  const acts: number[] = [];
  const local = instrument({ mode: 'local', setpoint: 20, door: 'closed' });
  await expect(deliverConvergent(delivery(local, 40, acts), signal)).rejects.toThrow(
    'The instrument is in local mode',
  );
  const open = instrument({ mode: 'remote', setpoint: 20, door: 'open' });
  expect(await deliverConvergent(delivery(open, 40, acts), signal)).toMatchObject({
    status: 'rejected',
    code: 'PRECONDITION',
    message: 'Set the setpoint not possible: door is open',
  });
  const unreadable = instrument({ mode: 'remote', setpoint: null, door: 'closed' });
  expect(await deliverConvergent(delivery(unreadable, 40, acts), signal)).toMatchObject({
    status: 'accepted',
  });
  expect(acts).toEqual([40]);
});

test('waitFor needs consecutive matches and returns the last view on timeout', async () => {
  const target = instrument({ mode: 'remote', setpoint: 20, door: 'closed' });
  const reached = await waitFor(
    target.clock,
    target.observe,
    (view) => view.setpoint === 40,
    50,
    signal,
    2,
  );
  expect(reached.matched).toBe(false);
  target.set({ setpoint: 40 });
  expect(
    (await waitFor(target.clock, target.observe, (view) => view.setpoint === 40, 50, signal, 2))
      .matched,
  ).toBe(true);
});

test('an interruption after acting is uncertain unless rerunnable', () => {
  expect(interruption(true, false, 'stopped')).toBeInstanceOf(DeliveryUncertain);
  expect(interruption(true, true, 'stopped')).not.toBeInstanceOf(DeliveryUncertain);
  expect(interruption(false, false, 'stopped')).toBeInstanceOf(DeliveryFailure);
});

test('lookup accepts a converged target and holds only what may have half-applied', async () => {
  const target = instrument({ mode: 'remote', setpoint: 30, door: 'closed' });
  const memory = new AttemptMemory();
  const effect = { id: 'e1', attempts: 1 } as Effect;
  const lookup = (rerunnable = false) => ({
    effect,
    rerunnable,
    untouched: memory.untouched(effect.id),
    readback: async (inner: AbortSignal) =>
      confirm(target.clock, target.observe, target.check(40), 1, await target.observe(), inner),
    accepted: (view: View) => ({
      status: 'accepted' as const,
      externalRef: `read:${view.setpoint}`,
    }),
    atStart: (view: View) => view.setpoint === 20,
    uncertain: (view: View) => `Setpoint reads ${view.setpoint}`,
  });
  expect(await lookupConvergent(lookup(), signal)).toEqual({
    status: 'uncertain',
    reason: 'Setpoint reads 30',
  });
  expect(await lookupConvergent(lookup(true), signal)).toBeUndefined();
  memory.attempt('e1');
  expect(await lookupConvergent(lookup(), signal)).toBeUndefined();
  memory.touch('e1');
  target.set({ setpoint: 40 });
  expect(await lookupConvergent(lookup(), signal)).toMatchObject({ status: 'accepted' });
});
