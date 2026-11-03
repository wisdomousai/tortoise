import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import { stationPaths } from '@agent-native/workstation-sign-in/contracts';
import { createToolStoreApplication } from '../application';

/**
 * Attendant sign-in at the counter terminal over HTTP. The connection file's token is the
 * terminal: the workspace owner, who enrolls badges and whose screen signs attendants in. An
 * attendant's token then acts as that attendant under the application's policy.
 */
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/** The error a refused request carries; `details.credential` is set when its token is rejected. */
const errorOf = async (response: Response) =>
  (
    (await response.json()) as {
      error: { code: string; message: string; details?: { credential?: string } };
    }
  ).error;

const members = {
  'mia@plant': 'attendant',
  'jonas@plant': 'attendant',
  'sam@plant': 'viewer',
} as const;

async function startCounter() {
  const clock = { now: Date.parse('2026-11-03T08:00:00Z') };
  const directory = await mkdtemp(join(tmpdir(), 'tool-store-terminal-'));
  const host = await startHost(
    createToolStoreApplication({ members, services: { now: () => clock.now } }),
    { workspacePath: directory, integration: false },
  );
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
  let keys = 0;
  const command = (token: string, operation: string, input: unknown) =>
    post(`/api/v1/commands/${operation}`, token, { input, idempotencyKey: `key-${++keys}` });
  const query = (token: string, operation: string, input: unknown = {}) =>
    post(`/api/v1/queries/${operation}`, token, { input });
  const enroll = async (principalId: string, badge: string, pin: string) => {
    const response = await post(stationPaths.enroll, terminal, {
      principalId,
      label: principalId,
      badge,
      pin,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { badge: { id: string } }).badge.id;
  };
  const signIn = (badge: string, pin: string, token = terminal) =>
    post(stationPaths.signIn, token, { badge, pin, terminal: 'counter' });
  const operatorToken = async (badge: string, pin: string) => {
    const response = await signIn(badge, pin);
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  };
  const created = await command(terminal, 'tool.create', {
    assetTag: 'TC-00601',
    description: 'Torque wrench 20-100 Nm',
    category: 'torque-tool',
    bin: 'A-03',
  });
  expect(created.status).toBe(200);
  const toolId = ((await created.json()) as { result: { id: string } }).result.id;
  const checkOut = (token: string) =>
    command(token, 'tool.check-out', {
      toolId,
      borrower: 'E004217',
      workOrder: 'WO-100',
      dueAt: '2026-11-05T16:00:00Z',
    });
  const toolStatus = async () =>
    (
      (await (await query(terminal, 'tool.get', { id: toolId })).json()) as {
        data: { status: string };
      }
    ).data.status;
  return {
    clock,
    terminal,
    post,
    command,
    query,
    enroll,
    signIn,
    operatorToken,
    toolId,
    checkOut,
    toolStatus,
  };
}

test('an attendant signs in with badge and PIN, and lends and takes back a tool as themselves', async () => {
  const { terminal, post, command, query, enroll, signIn, operatorToken, toolId, checkOut } =
    await startCounter();
  await enroll('mia@plant', 'E100001', '2468');
  expect((await signIn('E100001', '1111')).status).toBe(403);
  const response = await signIn('E100001', '2468');
  expect(response.status).toBe(201);
  const { token, session } = (await response.json()) as {
    token: string;
    session: { principalId: string; terminal: string };
  };
  expect(session).toMatchObject({ principalId: 'mia@plant', terminal: 'counter' });

  const lent = await checkOut(token);
  expect(lent.status).toBe(200);
  expect(((await lent.json()) as { result: unknown }).result).toMatchObject({
    toolId,
    borrower: 'E004217',
    checkedOutBy: 'mia@plant',
    checkedOutAt: Date.parse('2026-11-03T08:00:00Z'),
  });
  const returned = await command(token, 'tool.return', { toolId, condition: 'ok' });
  expect(returned.status).toBe(200);
  expect(((await returned.json()) as { result: unknown }).result).toMatchObject({
    checkedOutBy: 'mia@plant',
    returnedBy: 'mia@plant',
    condition: 'ok',
  });
  // The owner reads the same loan with the attendant on it.
  const loans = (await (await query(terminal, 'loan.list', { toolId })).json()) as {
    data: { items: unknown[] };
  };
  expect(loans.data.items).toMatchObject([{ checkedOutBy: 'mia@plant', returnedBy: 'mia@plant' }]);

  // Only the owner enrolls badges, and an attendant's session cannot sign anyone in.
  const own = await operatorToken('E100001', '2468');
  expect(
    (
      await post(stationPaths.enroll, own, {
        principalId: 'x',
        label: 'x',
        badge: 'E1',
        pin: '1234',
      })
    ).status,
  ).toBe(403);
  expect((await signIn('E100001', '2468', own)).status).toBe(403);
  expect((await query(terminal, 'station.badge.list')).status).toBe(200);
});

test("a viewer's badge signs in to read, and a check-out with it is refused", async () => {
  const { enroll, operatorToken, query, checkOut, toolStatus } = await startCounter();
  await enroll('sam@plant', 'E100003', '1357');
  const token = await operatorToken('E100003', '1357');
  expect((await query(token, 'loan.overdue')).status).toBe(200);
  // The token is valid; the policy refuses the viewer's role.
  const refused = await checkOut(token);
  expect(refused.status).toBe(403);
  expect(await errorOf(refused)).toEqual({ code: 'FORBIDDEN', message: 'RESOURCE_DENIED' });
  expect(await toolStatus()).toBe('available');
});

test('a revoked badge is refused, and revoking it ends its session', async () => {
  const { terminal, command, enroll, signIn, operatorToken, checkOut, toolStatus } =
    await startCounter();
  const badgeId = await enroll('mia@plant', 'E100001', '2468');
  const token = await operatorToken('E100001', '2468');
  expect((await command(terminal, 'station.badge.revoke', { badgeId })).status).toBe(200);
  const refused = await checkOut(token);
  expect(refused.status).toBe(403);
  expect((await errorOf(refused)).details).toEqual({ credential: 'rejected' });
  expect(await toolStatus()).toBe('available');
  const again = await signIn('E100001', '2468');
  expect(again.status).toBe(403);
  expect((await errorOf(again)).message).toBe('Badge or PIN not recognized');
});

test('the next sign-in at the counter ends the previous session, and a session expires', async () => {
  const { clock, enroll, operatorToken, query } = await startCounter();
  await enroll('mia@plant', 'E100001', '2468');
  await enroll('jonas@plant', 'E100002', '8642');
  const mia = await operatorToken('E100001', '2468');
  expect((await query(mia, 'tool.list')).status).toBe(200);
  const jonas = await operatorToken('E100002', '8642');
  expect((await query(mia, 'tool.list')).status).toBe(403);
  expect((await query(jonas, 'tool.list')).status).toBe(200);
  // Sessions last 15 minutes by default.
  clock.now += 16 * 60_000;
  expect((await query(jonas, 'tool.list')).status).toBe(403);
});
