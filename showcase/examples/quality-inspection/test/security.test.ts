import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { segmentName } from '@tortoise/event-log';
import { startHost } from '@tortoise/host/host';
import { auditServiceOf } from '@tortoise/audit';
import { writeApplicationEntry } from '../../../../scripts/application-entry';
import qualityInspection from '../application';

const withWorkspace = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'security-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const cli = async (directory: string, ...args: string[]) => {
  const entry = await writeApplicationEntry(
    'cli',
    join(directory, 'entry'),
    resolve(import.meta.dir, '..'),
  );
  const child = Bun.spawn([process.execPath, entry, ...args], {
    env: { PATH: process.env.PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout, exitCode };
};

test('auditors read posture over HTTP and the CLI verifies, reports and detects tampering', async () => {
  await withWorkspace(async (directory) => {
    const host = await startHost(qualityInspection, {
      workspacePath: directory,
      integration: false,
    });
    const auditLog = auditServiceOf(host.services).logDirectory;
    try {
      // The local owner is the default auditor; posture is a read-only query like any other.
      const owner = host.sessions.create({ workspaceId: 'local', principalId: 'owner' });
      const response = await fetch(`${host.url}/api/v1/queries/compliance.posture.get`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      expect(response.status).toBe(200);
      const posture = (await response.json()) as { data: Record<string, any> };
      expect(posture.data).toMatchObject({ networkMode: 'isolated', log: { verified: true } });
      expect(posture.data.catalogDigest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await host.close();
    }

    expect(await cli(directory, 'audit', 'verify', '--log', auditLog)).toMatchObject({
      exitCode: 0,
    });
    const report = await cli(
      directory,
      'compliance',
      'report',
      '--log',
      auditLog,
      '--format',
      'json',
    );
    expect(report.exitCode).toBe(0);
    expect(JSON.parse(report.stdout).posture.log.verified).toBe(true);

    const sample = join(import.meta.dir, '..', 'site-policy.sandbox.json');
    expect((await cli(directory, 'site', 'check', '--site', sample)).exitCode).toBe(0);
    const unit = await cli(directory, 'network', 'export', '--site', sample, '--format', 'systemd');
    expect(unit.stdout).toContain('IPAddressAllow=10.20.0.21/32');
    const zeroTrust = join(directory, 'zero-trust.json');
    await writeFile(zeroTrust, JSON.stringify({ profile: 'zero-trust' }));
    const refused = await cli(
      directory,
      'network',
      'export',
      '--site',
      zeroTrust,
      '--format',
      'json',
    );
    expect(refused).toEqual({ stdout: '', exitCode: 2 });

    // One changed byte breaks the chain, and verification says so with its own exit code.
    const segment = join(auditLog, segmentName(1));
    const text = await readFile(segment, 'utf8');
    await writeFile(segment, text.replace('"owner"', '"0wner"'));
    const tampered = await cli(directory, 'audit', 'verify', '--log', auditLog);
    expect(tampered.exitCode).toBe(10);
    expect(JSON.parse(tampered.stdout).ok).toBe(false);
  });
});
