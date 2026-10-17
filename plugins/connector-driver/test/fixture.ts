import { jsonSchema } from '@agent-native/contracts';
import { z } from 'zod';
import { createDriverConnector } from '../src/connect';
import { defineDriverContract } from '../src/contracts';
import { createDriverSupervisor, type DriverMode } from '../src/supervisor';
import { createFakeDriver, FakeRefusal } from '../src/testing';

/** A temperature chamber: one action per delivery mode, a door precondition and local control. */
export const chamber = defineDriverContract({
  id: 'chamber',
  version: '1.0.0',
  title: 'Test chamber',
  process: { id: 'chamber-driver', purpose: 'Drives the test chamber', availability: 'optional' },
  devices: [
    { id: 'chamber-port', kind: 'serial', purpose: 'Chamber RS-232', availability: 'optional' },
  ],
  lookup: true,
  control: { field: 'control', local: 'local' },
  state: {
    setpoint: { type: 'number', unit: '°C', decimals: 1 },
    door: { type: 'enum', options: ['open', 'closed'] },
    control: { type: 'enum', options: ['remote', 'local'] },
  },
  actions: {
    'setpoint.set': {
      title: 'Set the setpoint',
      input: jsonSchema(z.strictObject({ setpoint: z.number() })),
      delivery: 'convergent',
      hazard: 'low',
      timeoutMs: 1_000,
      readback: [{ field: 'setpoint', equals: '$input.setpoint' }],
      preconditions: [{ field: 'door', equals: 'closed' }],
    },
    'cycle.start': {
      title: 'Start a cycle',
      input: jsonSchema(
        z.strictObject({
          program: z.string(),
          presence: z.strictObject({ confirmedBy: z.string() }).optional(),
        }),
      ),
      delivery: 'once',
      hazard: 'operator-present',
      timeoutMs: 1_000,
    },
    'label.print': {
      title: 'Print a label',
      input: jsonSchema(z.strictObject({ text: z.string() })),
      delivery: 'idempotent',
      hazard: 'none',
      timeoutMs: 1_000,
    },
  },
  events: { reading: { kind: 'telemetry', maxRateHz: 1 } },
});

/** A fake chamber whose actions refuse an input marked `refuse`, like a real controller would. */
export function chamberDriver(options: { digest?: string } = {}) {
  const refuse = (input: unknown) => {
    const text = JSON.stringify(input);
    if (text.includes('refuse')) throw new FakeRefusal('rejected', 'Out of range', 'OUT_OF_RANGE');
  };
  return createFakeDriver({
    contract: chamber,
    ...options,
    state: { setpoint: 20, door: 'closed', control: 'remote' },
    devices: [{ serial: 'CH-0042', firmware: '3.1' }],
    actions: {
      'setpoint.set': (input, driver) => {
        const { setpoint } = input as { setpoint: number };
        if (setpoint > 300) throw new FakeRefusal('rejected', 'Out of range', 'OUT_OF_RANGE');
        driver.state.setpoint = setpoint;
      },
      'cycle.start': (input) => (refuse(input), { ref: 'cycle-1' }),
      'label.print': (input) => refuse(input),
    },
  });
}

/** A fake chamber behind a supervisor and connector, with no backoff and a fast clock. */
export function chamberConnector(mode: DriverMode = 'actuate', options: { digest?: string } = {}) {
  const driver = chamberDriver(options);
  const problems: string[] = [];
  const supervisor = createDriverSupervisor({
    contract: chamber,
    start: driver.start,
    mode: () => mode,
    backoff: { minMs: 0, maxMs: 0 },
    onProblem: (problem) => problems.push(problem),
  });
  const port = createDriverConnector({
    target: 'chamber',
    contract: chamber,
    supervisor,
    control: async () => ({ mode }),
    pollMs: 1,
  });
  return { driver, supervisor, port, problems };
}
