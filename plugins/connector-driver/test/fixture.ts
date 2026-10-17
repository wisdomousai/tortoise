import { createDriverConnector } from '../src/connect';
import { createDriverSupervisor, type DriverMode } from '../src/supervisor';
import { chamber, createFakeDriver, FakeRefusal } from '../src/testing';

export { chamber };

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
