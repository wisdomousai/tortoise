import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import { stationPaths } from '@agent-native/workstation-sign-in/contracts';
import { createLabRequestsSignInApplication } from '../application';

/**
 * The bench over HTTP: the owner's session is the seat and enrolls badges, and an operator who
 * signs in there works on test requests as themselves until the session ends.
 */
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function startBench() {
  const clock = { now: Date.now() };
  const directory = await mkdtemp(join(tmpdir(), 'pattern-lab-requests-sign-in-'));
  const host = await startHost(createLabRequestsSignInApplication({ now: () => clock.now }), {
    workspacePath: directory,
    integration: false,
  });
  cleanups.push(async () => {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { token: seat } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const post = (path: string, token: string, body: unknown) =>
    fetch(host.url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const enroll = async (principalId: string, badge: string, pin: string) =>
    expect(
      (await post(stationPaths.enroll, seat, { principalId, label: principalId, badge, pin }))
        .status,
    ).toBe(201);
  const signIn = async (badge: string, pin: string) => {
    const response = await post(stationPaths.signIn, seat, { badge, pin, seat: 'bench-2' });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  };
  const submit = (token: string, specimen: string) =>
    post('/api/v1/commands/test-request.submit', token, {
      input: { specimen, description: 'Hardness of the heat-treated shaft' },
      idempotencyKey: crypto.randomUUID(),
    });
  const list = async (token: string) => {
    const response = await post('/api/v1/queries/test-request.list', token, { input: {} });
    if (!response.ok) return response.status;
    return (
      (await response.json()) as { data: { items: { specimen: string; requester: string }[] } }
    ).data.items;
  };
  return { clock, seat, post, enroll, signIn, submit, list };
}

test('a technician signs in at the bench with a PIN that starts with zero and submits as themselves', async () => {
  const { enroll, signIn, submit, list } = await startBench();
  await enroll('ana', 'LAB-0042', '0420');
  const ana = await signIn('LAB-0042', '0420');

  const submitted = await submit(ana, 'B-1042-03');
  expect(submitted.status).toBe(200);
  expect(((await submitted.json()) as { result: { requester: string } }).result.requester).toBe(
    'ana',
  );
  expect(await list(ana)).toEqual([
    expect.objectContaining({ specimen: 'B-1042-03', requester: 'ana' }),
  ]);
});

test('the next sign-in at the bench ends the previous session, and a viewer cannot submit', async () => {
  const { enroll, signIn, submit, list, post } = await startBench();
  await enroll('ana', 'LAB-0042', '0420');
  await enroll('ben', 'LAB-0043', '1357');
  const ana = await signIn('LAB-0042', '0420');
  expect((await submit(ana, 'B-1042-03')).status).toBe(200);

  const ben = await signIn('LAB-0043', '1357');
  expect(await list(ana)).toBe(403);
  expect(await list(ben)).toEqual([expect.objectContaining({ requester: 'ana' })]);
  const refused = await submit(ben, 'B-1042-04');
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  // An operator administers no badges.
  expect((await post('/api/v1/queries/station.badge.list', ben, { input: {} })).status).toBe(403);
});

test('an operator session ends when it expires, and a revoked badge cannot sign in', async () => {
  const { clock, seat, enroll, signIn, list, post } = await startBench();
  await enroll('ana', 'LAB-0042', '0420');
  const ana = await signIn('LAB-0042', '0420');
  clock.now += 16 * 60_000;
  expect(await list(ana)).toBe(403);

  const listed = (await (
    await post('/api/v1/queries/station.badge.list', seat, { input: {} })
  ).json()) as {
    data: { badges: { id: string }[] };
  };
  const revoked = await post('/api/v1/commands/station.badge.revoke', seat, {
    input: { badgeId: listed.data.badges[0]!.id },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(revoked.status).toBe(200);
  const refused = await post(stationPaths.signIn, seat, {
    badge: 'LAB-0042',
    pin: '0420',
    seat: 'bench-2',
  });
  expect(refused.status).toBe(403);
});
