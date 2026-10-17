import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { driverCliCommand } from '../src/cli';
import { driverContractDigest } from '../src/supervisor';
import { checkDriver } from '../src/testing';
import { chamber, chamberDriver } from './fixture';

const failed = (checks: readonly { name: string; passed: boolean }[]) =>
  checks.filter((check) => !check.passed).map((check) => check.name);

describe('driver check', () => {
  test('the fake driver passes every check, and one built for another contract fails the handshake', async () => {
    expect(failed(await checkDriver({ contract: chamber, start: chamberDriver().start }))).toEqual(
      [],
    );
    const other = await checkDriver({
      contract: chamber,
      start: chamberDriver({ digest: '0'.repeat(64) }).start,
    });
    expect(other).toEqual([
      { name: 'handshake', passed: false, detail: expect.stringContaining('another contract') },
    ]);
  });

  test('a value outside its declaration fails the state check', async () => {
    const driver = chamberDriver();
    driver.state.door = 'ajar';
    const checks = await checkDriver({ contract: chamber, start: driver.start });
    expect(failed(checks)).toEqual(['state.read']);
    expect(checks.find((check) => check.name === 'state.read')!.detail).toContain('door');
  });

  test('driver check runs a real executable over stdio and exits nonzero on a failed check', async () => {
    const command = driverCliCommand([chamber]);
    const script = join(import.meta.dir, 'fixtures', 'chamber-driver.ts');
    const digest = driverContractDigest(chamber);
    const output: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((text) => {
      output.push(String(text));
      return true;
    });
    try {
      const args = ['driver', 'check', 'chamber', '--', process.execPath, script];
      expect(await command.run({} as never, [...args, digest])).toBe(0);
      expect(output.join('')).toContain('pass  handshake  chamber-script 0.1.0, 1 unit(s)');
      expect(await command.run({} as never, [...args, digest, 'ajar'])).toBe(1);
      expect(output.join('')).toContain('FAIL  state.read');
      expect(await command.run({} as never, ['driver', 'list'])).toBe(0);
      expect(output.join('')).toContain(`digest   ${digest}`);
    } finally {
      write.mockRestore();
    }
    expect(await command.run({} as never, ['other'])).toBeUndefined();
    await expect(command.run({} as never, ['driver', 'check', 'oven'])).rejects.toThrow(
      'No driver oven',
    );
    await expect(
      command.run({} as never, ['driver', 'check', 'chamber', '--', 'bun']),
    ).rejects.toThrow('absolute executable');
  });
});
