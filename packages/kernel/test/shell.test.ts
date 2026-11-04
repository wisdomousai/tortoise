import { describe, expect, test } from 'bun:test';
import { defaultPorts, latePorts, resolvePorts } from '../src/index';

const context = { workspaceId: 'local', principalId: 'local-user' };

describe('shell port', () => {
  test('without a provider every call is refused as unavailable', async () => {
    const { shell } = defaultPorts();
    await expect(shell.receive(context, { kind: 'url', url: 'x' }, 'macos')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(shell.perform(context, { action: 'x' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(() =>
      shell.attach(context, { platform: 'macos', perform: async () => ({ ok: true }) }),
    ).toThrow('no plugin that provides the shell port');
  });

  test('one plugin may provide it, and the late view reads the composed port', () => {
    const shell = { ...defaultPorts().shell };
    const late = latePorts();
    expect(() => late.ports.shell).toThrow('once every plugin has opened');
    const composed = resolvePorts([{ id: 'os', instance: { ports: { shell } } }]);
    late.bind(composed);
    expect(late.ports.shell).toBe(shell);
    expect(() =>
      resolvePorts([
        { id: 'os', instance: { ports: { shell } } },
        { id: 'other', instance: { ports: { shell } } },
      ]),
    ).toThrow('both provide the shell port');
  });
});
