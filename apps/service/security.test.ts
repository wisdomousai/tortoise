import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPolicyUsable, EgressDenied, loadSitePolicy } from '@agent-native/egress';
import {
  openJsonlEventLog,
  readEvents,
  segmentName,
  verifyEventLog,
} from '@agent-native/event-log';
import { startHost } from './src/host';
import { openEmbeddedAuthority } from './src/embedded';
import { demoSystemOfRecord } from './src/demo';
import { deploymentRequirements } from './src/security';

const withWorkspace = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'security-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('the host attests, audits each channel and leaves a verifiable chain', async () => {
  await withWorkspace(async (directory) => {
    const host = await startHost({ workspacePath: directory, integration: false });
    const auditLog = host.security.logDirectory;
    try {
      expect(host.security.policy.mode).toBe('isolated');
      const owner = host.sessions.create({ workspaceId: 'local', principalId: 'owner' });
      const response = await fetch(`${host.url}/api/v1/commands/project.create`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { name: 'Audited over HTTP' },
          idempotencyKey: 'audit-http-1',
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      await host.close();
    }
    const events = await readEvents(auditLog);
    const kinds = events.map((event) => event.kind);
    expect(kinds.slice(0, 3)).toEqual(['log.opened', 'config.loaded', 'policy.loaded']);
    const loaded = events.find((event) => event.kind === 'config.loaded')!;
    expect(loaded.data).toMatchObject({ profile: 'desktop-local', networkMode: 'isolated' });
    expect(String(loaded.data!.catalogDigest)).toMatch(/^[0-9a-f]{64}$/);
    // Isolation is explicit: every egress destination is listed with what it disables.
    const consequences = events.find((event) => event.kind === 'policy.loaded')!.data!
      .consequences as { destination: string }[];
    expect(consequences.map((item) => item.destination)).toContain('openai-api');
    const committed = events.filter(
      (event) => event.kind === 'command.committed' && event.operation === 'project.create',
    );
    expect(committed).toHaveLength(1);
    expect(committed[0]!.actor).toMatchObject({ principalId: 'owner', via: 'http' });
    // The project name is not allow-listed for audit, so only a digest of the input is kept.
    expect(JSON.stringify(events)).not.toContain('Audited over HTTP');
    expect((await verifyEventLog(auditLog)).ok).toBe(true);
  });
});

test('an unusable site policy refuses startup and releases the workspace', async () => {
  await withWorkspace(async (directory) => {
    const policy = join(directory, 'zero-trust.json');
    // Zero trust refuses the trusted local-owner identity and an unforwarded audit log.
    await writeFile(policy, JSON.stringify({ profile: 'zero-trust' }));
    const workspacePath = join(directory, 'workspace');
    await expect(
      startHost({ workspacePath, integration: false, security: { sitePolicy: policy } }),
    ).rejects.toThrow(/Site policy rejected \(zero-trust\)[\s\S]*IDENTITY_FLOOR/);
    const host = await startHost({ workspacePath, integration: false });
    await host.close();
  });
});

test('startup resolves a command accepted before a crash', async () => {
  await withWorkspace(async (directory) => {
    const auditLog = join(directory, 'audit');
    const workspacePath = join(directory, 'workspace');
    const first = await startHost({
      workspacePath,
      integration: false,
      security: { eventLogDirectory: auditLog },
    });
    await first.close();
    // Simulate a crash between the in-transaction `accepted` and the post-commit outcome.
    const log = await openJsonlEventLog({
      directory: auditLog,
      source: { component: 'authority', instance: 'crashed' },
    });
    await log.append([
      {
        kind: 'command.accepted',
        outcome: 'accepted',
        operation: 'project.create',
        actor: { principalId: 'owner', workspaceId: 'local' },
        correlationId: 'orphan',
        cursor: 999,
        data: { fromCursor: 998 },
      },
    ]);
    await log.close();
    const second = await startHost({
      workspacePath,
      integration: false,
      security: { eventLogDirectory: auditLog },
    });
    await second.close();
    const resolution = (await readEvents(auditLog)).filter(
      (event) => event.correlationId === 'orphan',
    );
    expect(resolution.map((event) => event.kind)).toEqual(['command.accepted', 'command.aborted']);
    expect((await verifyEventLog(auditLog)).ok).toBe(true);
  });
});

test('provider egress is denied unless the site policy binds it', async () => {
  await withWorkspace(async (directory) => {
    const policy = join(directory, 'site-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        mode: 'connected',
        destinations: {
          'openai-auth': { disabled: true, reason: 'No ChatGPT sign-in here' },
          'quality-system-api': { disabled: true },
          'mes-api': { disabled: true },
        },
      }),
    );
    const host = await startHost({
      workspacePath: join(directory, 'workspace'),
      integration: false,
      security: { sitePolicy: policy },
    });
    try {
      const providerFetch = host.security.egress.routedFetch(['openai-auth', 'openai-api']);
      const denial = async (url: string) =>
        providerFetch(url).then(
          () => undefined,
          (error: unknown) => error,
        );
      const disabled = await denial('https://auth.openai.com/oauth/token');
      expect(disabled).toBeInstanceOf(EgressDenied);
      expect(disabled).toMatchObject({ code: 'UNAVAILABLE', reason: 'DISABLED' });
      expect(await denial('https://api.openai.com/v1/models')).toMatchObject({
        reason: 'UNBOUND',
      });
      expect(await denial('https://example.com/')).toMatchObject({ reason: 'ORIGIN_MISMATCH' });
    } finally {
      await host.close();
    }
  });
});

test('the embedded authority shares the audit log and its writer lock', async () => {
  await withWorkspace(async (directory) => {
    const auditLog = join(directory, 'audit');
    const authority = await openEmbeddedAuthority({
      workspacePath: join(directory, 'workspace'),
      systemOfRecord: demoSystemOfRecord({}),
      security: { eventLogDirectory: auditLog },
    });
    try {
      // A second workspace cannot write into a log another authority holds open.
      await expect(
        openEmbeddedAuthority({
          workspacePath: join(directory, 'other'),
          systemOfRecord: demoSystemOfRecord({}),
          security: { eventLogDirectory: auditLog },
        }),
      ).rejects.toThrow(/Event log is open in another process/);
      await authority.application.invokeRaw(
        { operation: 'project.create', input: { name: 'Embedded' } },
        { workspaceId: 'local', principalId: 'owner', channel: 'cli' },
      );
    } finally {
      await authority.close();
    }
    const committed = (await readEvents(auditLog, { kinds: ['command.committed'] })).filter(
      (event) => event.operation === 'project.create',
    );
    expect(committed[0]!.actor).toMatchObject({ via: 'cli' });
    expect(committed[0]!.source.component).toBe('embedded');
  });
});

test('the policy shipped with the desktop build binds only provider endpoints', async () => {
  const policy = await loadSitePolicy(
    join(import.meta.dir, '../desktop/site-policy.json'),
    deploymentRequirements(),
  );
  expect(() => assertPolicyUsable(policy)).not.toThrow();
  expect([...policy.bindings.keys()].sort()).toEqual([
    'anthropic-api',
    'openai-api',
    'openai-auth',
  ]);
  expect(policy.policy.audit.mode).toBe('fail-closed');
});

const cli = async (...args: string[]) => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'src/cli.ts'), ...args], {
    env: { PATH: process.env.PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout, exitCode };
};

test('auditors read posture over HTTP and the CLI verifies, reports and detects tampering', async () => {
  await withWorkspace(async (directory) => {
    const host = await startHost({ workspacePath: directory, integration: false });
    const auditLog = host.security.logDirectory;
    try {
      // The local owner is the default auditor; posture is a read-only query like any other.
      const owner = host.sessions.create({ workspaceId: 'local', principalId: 'owner' });
      const response = await fetch(`${host.url}/api/v1/queries/assurance.posture.get`, {
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

    expect(await cli('audit', 'verify', '--log', auditLog)).toMatchObject({ exitCode: 0 });
    const report = await cli('audit', 'report', '--log', auditLog, '--format', 'json');
    expect(report.exitCode).toBe(0);
    expect(JSON.parse(report.stdout).posture.log.verified).toBe(true);

    const sample = join(import.meta.dir, 'site-policy.sandbox.json');
    expect((await cli('security', 'check', '--site', sample)).exitCode).toBe(0);
    const unit = await cli('security', 'export', '--site', sample, '--format', 'systemd');
    expect(unit.stdout).toContain('IPAddressAllow=10.20.0.21/32');
    const zeroTrust = join(directory, 'zero-trust.json');
    await writeFile(zeroTrust, JSON.stringify({ profile: 'zero-trust' }));
    const refused = await cli('security', 'export', '--site', zeroTrust, '--format', 'json');
    expect(refused).toEqual({ stdout: '', exitCode: 2 });

    // One changed byte breaks the chain, and verification says so with its own exit code.
    const segment = join(auditLog, segmentName(1));
    const text = await readFile(segment, 'utf8');
    await writeFile(segment, text.replace('"owner"', '"0wner"'));
    const tampered = await cli('audit', 'verify', '--log', auditLog);
    expect(tampered.exitCode).toBe(10);
    expect(JSON.parse(tampered.stdout).ok).toBe(false);
  });
});
