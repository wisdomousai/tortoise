import { describe, expect, test } from 'bun:test';
import { conformanceEffect, connectorConformance } from '@tortoise/testing/connectors';
import { chamberConnector } from './fixture';

/** Accepted and refused inputs per action, one action per delivery mode. */
const inputs = {
  'setpoint.set': { accepted: (n: number) => ({ setpoint: 40 + n }), rejected: { setpoint: 999 } },
  'cycle.start': {
    accepted: (n: number) => ({ program: `p${n}`, presence: { confirmedBy: 'ina' } }),
    rejected: { program: 'refuse', presence: { confirmedBy: 'ina' } },
  },
  'label.print': { accepted: (n: number) => ({ text: `lot ${n}` }), rejected: { text: 'refuse' } },
} as const;

for (const [type, input] of Object.entries(inputs))
  describe(`the driver connector conforms for ${type}`, () => {
    for (const check of connectorConformance(async () => {
      const { driver, supervisor, port } = chamberConnector();
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
        applied: async (target) => driver.applied(target.id),
        failNext: () => driver.failNext('transient'),
        interruptNext: () => driver.crashNext(),
        close: () => supervisor.close(),
      };
    }))
      test(check.name, async () => {
        const result = await check.run();
        // Drivers have no pull; every other case must run.
        expect(result).toEqual(
          check.name.startsWith('pull')
            ? { skipped: 'the connector has no pull' }
            : { passed: true },
        );
      });
  });
