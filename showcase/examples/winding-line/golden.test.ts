import { expect, test } from 'bun:test';
import { join } from 'node:path';

// The golden gate as CI runs it: recorded frames, accessibility extractor, and recorded
// expectations standing in for the pixel model. No model is configured, so none is called.
test('the recorded golden frames pass the station profile gate', async () => {
  const root = join(import.meta.dir, '../../..');
  const child = Bun.spawn(
    [process.execPath, 'scripts/station-golden.ts', 'showcase/examples/winding-line/golden'],
    {
      cwd: root,
      env: { PATH: process.env.PATH },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe('');
  expect(stdout).toContain('Screens identified: 5/5');
  expect(stdout).toContain('PASS');
  expect(exitCode).toBe(0);
});
