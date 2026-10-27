import { existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonSchema } from '@agent-native/contracts';
import {
  conformanceEffect,
  connectorConformance,
  type ConformanceCase,
} from '@agent-native/testing/connectors';
import { z } from 'zod';
import { createDriverConnector } from '../connect/connector';
import { defineDriverContract } from '../contracts/define';
import { createDriverSupervisor, type DriverProcess } from '../supervisor';

/**
 * The reference contract every driver SDK proves itself against: a temperature chamber with one
 * action per delivery mode, a door precondition and local control. An SDK ships a simulated
 * chamber written with it, and runs `chamberConformance` over that executable.
 */
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
      risk: 'low',
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
      risk: 'operator-present',
      timeoutMs: 1_000,
    },
    'label.print': {
      title: 'Print a label',
      input: jsonSchema(z.strictObject({ text: z.string() })),
      delivery: 'idempotent',
      risk: 'none',
      timeoutMs: 1_000,
    },
  },
  events: { reading: { kind: 'telemetry', maxRateHz: 1 } },
});

/**
 * One simulated chamber an SDK runs. The simulator keeps its state in `home`, the directory it
 * reads from `CHAMBER_SIM_DIR`:
 * - `applied.json` counts actions applied per effect ID;
 * - an empty `fail-next` file makes the next action fail before it acts (transient);
 * - an empty `crash-next` file makes the next action act and then exit before responding.
 * Any input containing the text `refuse` is rejected with `OUT_OF_RANGE`, and a setpoint above 300 too.
 */
export interface ChamberSimulation {
  readonly home: string;
  readonly start: () => Promise<DriverProcess>;
}

const inputs = {
  'setpoint.set': { accepted: (n: number) => ({ setpoint: 40 + n }), rejected: { setpoint: 999 } },
  'cycle.start': {
    accepted: (n: number) => ({ program: `p${n}`, presence: { confirmedBy: 'ina' } }),
    rejected: { program: 'refuse', presence: { confirmedBy: 'ina' } },
  },
  'label.print': { accepted: (n: number) => ({ text: `lot ${n}` }), rejected: { text: 'refuse' } },
} as const;

/**
 * The shared connector conformance suite, once per chamber action (one per delivery mode), over a
 * fresh simulated chamber per case, as a real child process with the SDK's journal across
 * restarts. Pull cases are skipped: a driver has nothing to pull.
 */
export function chamberConformance(
  simulation: () => ChamberSimulation,
): { readonly action: string; readonly cases: ConformanceCase[] }[] {
  return Object.entries(inputs).map(([type, input]) => ({
    action: type,
    cases: connectorConformance(async () => {
      const sim = simulation();
      const supervisor = createDriverSupervisor({
        contract: chamber,
        start: sim.start,
        backoff: { minMs: 0, maxMs: 0 },
        healthMs: 0,
      });
      const port = createDriverConnector({
        target: 'chamber',
        contract: chamber,
        supervisor,
        control: async () => ({ mode: 'actuate' }),
        pollMs: 5,
      });
      const applied = async (id: string) => {
        const file = join(sim.home, 'applied.json');
        return existsSync(file)
          ? ((JSON.parse(await readFile(file, 'utf8')) as Record<string, number>)[id] ?? 0)
          : 0;
      };
      let next = 0;
      const effect = (payload: object) =>
        conformanceEffect({
          id: `${type}-${++next}`,
          target: 'chamber',
          type,
          payload: payload as never,
        });
      return {
        port,
        accepted: () => effect(input.accepted(next)),
        rejected: () => effect(input.rejected),
        applied: (target) => applied(target.id),
        failNext: () => writeFileSync(join(sim.home, 'fail-next'), ''),
        interruptNext: () => writeFileSync(join(sim.home, 'crash-next'), ''),
        close: () => supervisor.close(),
      };
    }),
  }));
}
