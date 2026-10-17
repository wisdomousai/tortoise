import { describe, expect, test } from 'bun:test';
import { defaultPorts, latePorts, resolvePorts } from '../src/index';

describe('process port', () => {
  test('without a provider nothing starts and availability says why', async () => {
    const { processes } = defaultPorts();
    expect(processes.availability('driver')).toMatchObject({
      available: false,
      reason: expect.stringContaining('no plugin that provides the process port'),
    });
    await expect(processes.spawn('driver')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  test('one plugin may provide it, and the late view reads the composed port', () => {
    const processes = { ...defaultPorts().processes };
    const late = latePorts();
    expect(() => late.ports.processes).toThrow('once every plugin has opened');
    late.bind(resolvePorts([{ id: 'process', instance: { ports: { processes } } }]));
    expect(late.ports.processes).toBe(processes);
    expect(() =>
      resolvePorts([
        { id: 'process', instance: { ports: { processes } } },
        { id: 'other', instance: { ports: { processes } } },
      ]),
    ).toThrow('both provide the processes port');
  });
});
