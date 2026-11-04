import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@tortoise/host/host';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { stationPaths } from '../src/contracts';
import { stationApplication } from './fixtures';

/**
 * Shared-station sign-in on a serving host over HTTP: the local user's screen is the terminal, operators
 * sign in there with a badge and PIN, and their token acts as them until it ends.
 */
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function startStation() {
  const clock = { now: Date.now() };
  const directory = await mkdtemp(join(tmpdir(), 'station-'));
  const host = await startHost(stationApplication({ now: () => clock.now }), {
    workspacePath: directory,
    integration: false,
  });
  cleanups.push(async () => {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { token: terminal } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const post = (path: string, token: string, body: unknown) =>
    fetch(host.url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const whoami = async (token: string) => {
    const response = await post('/api/v1/queries/work.whoami', token, { input: {} });
    return response.ok
      ? ((await response.json()) as { data: { principalId: string } }).data.principalId
      : response.status;
  };
  const signIn = (badge: string, pin: string, terminalName = 'press-1', token = terminal) =>
    post(stationPaths.signIn, token, { badge, pin, terminal: terminalName });
  return { host, clock, terminal, post, whoami, signIn };
}

test('an operator signs in at a terminal with badge and PIN, acts as themselves, and signs out', async () => {
  const { host, terminal, post, whoami, signIn } = await startStation();
  const enrolled = await post(stationPaths.enroll, terminal, {
    principalId: 'ada@plant',
    label: 'Ada',
    badge: 'BADGE-0042',
    pin: '2468',
  });
  expect(enrolled.status).toBe(201);

  const response = await signIn('BADGE-0042', '2468');
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { token, session } = (await response.json()) as {
    token: string;
    session: { principalId: string; terminal: string };
  };
  expect(session).toMatchObject({ principalId: 'ada@plant', terminal: 'press-1' });
  expect(await whoami(token)).toBe('ada@plant');
  expect(await whoami(terminal)).toBe(LOCAL_USER);
  // An operator is not an admin of badges, and cannot sign others in from their own session.
  expect((await post('/api/v1/queries/station.badge.list', token, { input: {} })).status).toBe(403);
  expect((await signIn('BADGE-0042', '2468', 'press-1', token)).status).toBe(403);

  // Neither the badge value nor the PIN is stored in state or in a receipt.
  const listed = await host.application.queryRaw(
    { operation: 'station.badge.list', input: {} },
    { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER },
  );
  expect(JSON.stringify(listed.data)).not.toContain('BADGE-0042');
  const files = ['workspace.sqlite', 'workspace.sqlite-wal'].map((name) =>
    Bun.file(join(host.workspacePath, name)),
  );
  let database = '';
  for (const file of files) if (await file.exists()) database += await file.text();
  expect(database).not.toContain('BADGE-0042');
  expect(database).not.toContain('"2468"');

  // After a reload the terminal gets the session back for its own terminal name only, and an
  // operator token cannot ask for it.
  const restore = (as: string, terminalName = 'press-1') =>
    post(stationPaths.session, as, { token, terminal: terminalName });
  const restored = await restore(terminal);
  expect(restored.status).toBe(200);
  expect(((await restored.json()) as { session: unknown }).session).toMatchObject({
    principalId: 'ada@plant',
  });
  expect((await restore(terminal, 'press-2')).status).toBe(404);
  expect((await restore(token)).status).toBe(403);

  // Signing in again at the same terminal ends the previous operator's session.
  const second = (await (await signIn('BADGE-0042', '2468')).json()) as { token: string };
  expect(await whoami(token)).toBe(403);
  expect((await restore(terminal)).status).toBe(404);
  expect((await post(stationPaths.signOut, terminal, { token: second.token })).status).toBe(200);
  expect(await whoami(second.token)).toBe(403);
});

test('wrong PINs lock the badge, sessions expire, and revoking a badge ends its sessions', async () => {
  const { clock, terminal, post, whoami, signIn } = await startStation();
  await post(stationPaths.enroll, terminal, {
    principalId: 'bo@plant',
    label: 'Bo',
    badge: 'BADGE-7',
    pin: '1357',
  });
  expect((await signIn('BADGE-UNKNOWN', '1357')).status).toBe(403);
  for (let attempt = 0; attempt < 4; attempt++)
    expect(await (await signIn('BADGE-7', '0000')).text()).toContain('not recognized');
  expect(await (await signIn('BADGE-7', '0000')).text()).toContain('locked');
  // Locked: even the right PIN is refused until the lockout passes.
  expect(await (await signIn('BADGE-7', '1357')).text()).toContain('locked');
  clock.now += 16 * 60_000;
  const { token } = (await (await signIn('BADGE-7', '1357')).json()) as { token: string };
  expect(await whoami(token)).toBe('bo@plant');
  clock.now += 16 * 60_000;
  expect(await whoami(token)).toBe(403);

  const again = (await (await signIn('BADGE-7', '1357', 'press-2')).json()) as { token: string };
  const { badges } = (
    (await (await post('/api/v1/queries/station.badge.list', terminal, { input: {} })).json()) as {
      data: { badges: { id: string }[] };
    }
  ).data;
  await post('/api/v1/commands/station.badge.revoke', terminal, {
    input: { badgeId: badges[0]!.id },
    idempotencyKey: 'revoke-1',
  });
  expect(await whoami(again.token)).toBe(403);
  expect((await signIn('BADGE-7', '1357')).status).toBe(403);
});
