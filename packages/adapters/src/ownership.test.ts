import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireWorkspaceOwnership, WorkspaceOwnedError } from './ownership';

test('OS lock rejects second process and symlink alias, and a crash releases it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-owner-'));
  const workspace = join(directory, 'workspace');
  const owner = await acquireWorkspaceOwnership(workspace);
  try {
    await symlink(workspace, join(directory, 'alias'));
    await expect(acquireWorkspaceOwnership(join(directory, 'alias'))).rejects.toBeInstanceOf(
      WorkspaceOwnedError,
    );
    const source = `import { acquireWorkspaceOwnership } from ${JSON.stringify(import.meta.dir + '/ownership.ts')}; try { await acquireWorkspaceOwnership(process.argv[1]); console.log('owned'); } catch { process.exit(23); }`;
    const contender = Bun.spawn([process.execPath, '-e', source, workspace], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await contender.exited).toBe(23);
    await owner.release();
    const crashed = Bun.spawn(
      [process.execPath, '-e', source + '; await new Promise(() => {});', workspace],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const reader = crashed.stdout.getReader();
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain('owned');
    crashed.kill('SIGKILL');
    await crashed.exited;
    const recovered = await acquireWorkspaceOwnership(workspace);
    await recovered.release();
  } finally {
    await owner.release();
    await rm(directory, { recursive: true, force: true });
  }
});
