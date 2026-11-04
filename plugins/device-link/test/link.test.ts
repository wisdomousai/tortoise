import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { startHost } from '@tortoise/host/host';
import { openMobileInstance, type MobileInstance } from '@tortoise/mobile';
import { enrollPath as deviceEnrollPath } from '@tortoise/hub-link/contracts';
import { hubLinkServiceOf } from '@tortoise/hub-link/plugin';
import { enrollPath } from '../src/contracts';
import { devicePlatform, fieldApplication, hubApplication, memorySecrets } from './fixtures';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);

/** A hub on loopback whose field devices may ingest captures and read the assignment inbound query. */
async function startHub(clock = { now: Date.now() }) {
  const directory = await mkdtemp(join(tmpdir(), 'hub-'));
  const hub = await startHost(hubApplication({ now: () => clock.now }), {
    workspacePath: directory,
    integration: false,
    settings: { 'device-link-sync-operations': 'captures.ingest,assignments.inbound' },
  });
  cleanups.push(async () => {
    await hub.close();
    await rm(directory, { recursive: true, force: true });
  });
  const command = async (operation: string, input: unknown) =>
    (
      await hub.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        localUser,
      )
    ).result as Record<string, any>;
  const query = async (operation: string, input: unknown = {}) =>
    (await hub.application.queryRaw({ operation, input }, localUser)).data as Record<string, any>;
  const enrollment = async (kind: 'field-sync' | 'attached', operations?: string[]) =>
    (await command('link.enrollment.create', {
      label: kind === 'attached' ? 'Tablet' : 'Phone',
      kind,
      ...(operations ? { operations } : {}),
    })) as { enrollmentId: string; code: string; expiresAt: number };
  /** The device's half of pairing without the app, as a tablet or a script would do it. */
  const redeem = (code: string) =>
    fetch(hub.url + enrollPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  /** Call the hub API with a bearer credential, as a paired device does. */
  const api = (token: string, path: string, body: unknown) =>
    fetch(hub.url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { hub, command, query, enrollment, redeem, api };
}

/**
 * The field app on the mobile platform with Bun bindings. `link.drop` loses the hub's reply to the
 * next command after the hub has handled it, as a dropped connection would.
 */
async function openField() {
  const link = { drop: false, offline: false };
  const fieldFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (link.offline) throw new TypeError('Network is unreachable');
    const response = await fetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (!link.drop || !url.includes('/api/v1/commands/')) return response;
    link.drop = false;
    throw new TypeError('Connection reset');
  }) as typeof fetch;
  const secrets = memorySecrets();
  const { platform, cleanup } = devicePlatform(secrets);
  const field = await openMobileInstance(fieldApplication({ fetch: fieldFetch }), { platform });
  cleanups.push(async () => {
    await field.close();
    cleanup();
  });
  // The keystore holds one entry, the device credential.
  const token = () => [...secrets.values.values()][0]!;
  return { field, link, token, pairing: hubLinkServiceOf(field.instance.services)! };
}

const deliver = (field: MobileInstance) =>
  field.instance.integrations.target('hub').dispatcher.runOnce(undefined, { ignoreBackoff: true });
const effects = (field: MobileInstance) =>
  field.instance.application.pendingEffects(field.context, { target: 'hub' });
const captures = async (field: MobileInstance) =>
  (await field.transport.query('capture.list', {})).data as {
    captures: { id: string; sync: string; code?: string }[];
    assignments: string[];
  };
async function capture(field: MobileInstance, id: string, note = 'nameplate') {
  const photo = await field.transport.blobs!.put(jpeg, 'image/jpeg');
  await field.transport.command('capture.record', { id, note, photo }, { idempotencyKey: id });
  return photo;
}

test('a paired phone delivers captures with photos exactly once, and reads the assignment inbound query', async () => {
  const { hub, query, command, enrollment } = await startHub();
  const { field, link, pairing } = await openField();

  // Captured before pairing: the record waits in the outbox with the reason.
  const photo = await capture(field, 'c1');
  expect(await deliver(field)).toMatchObject({ retried: 1 });
  expect((await effects(field))[0]!.lastFailure).toBeDefined();

  // A wrong code is refused and the device shows why.
  await expect(pairing.pair({ origin: hub.url, code: 'WRONGCODE2' })).rejects.toThrow(
    'Enrollment code is invalid, expired or already used',
  );
  expect((await field.transport.query('hub.pairing.get', {})).data).toMatchObject({
    pairing: null,
    lastError: 'Enrollment code is invalid, expired or already used',
  });

  const { code } = await enrollment('field-sync');
  const paired = await pairing.pair({ origin: hub.url, code });
  expect(paired).toMatchObject({ origin: hub.url, kind: 'field-sync', label: 'Phone' });
  expect((await field.transport.query('hub.pairing.get', {})).data).toMatchObject({
    pairing: { deviceId: paired.deviceId },
  });

  // The hub handles the record but its response is lost: the effect stays pending.
  link.drop = true;
  expect(await deliver(field)).toMatchObject({ retried: 1 });
  expect(await query('captures.list')).toEqual({
    captures: [{ id: 'c1', note: 'nameplate', by: `device:${paired.deviceId}` }],
  });
  // Delivering again returns the hub's first command result; the hub still holds one capture.
  expect(await deliver(field)).toMatchObject({ accepted: 1 });
  expect((await query('captures.list')).captures).toHaveLength(1);
  expect((await captures(field)).captures).toEqual([{ id: 'c1', sync: 'accepted' }]);

  // The photo went up before the record and the hub keeps it with the capture.
  const owned = await hub.application.readBlob(photo.digest, localUser);
  expect(owned?.data).toEqual(jpeg);

  // Offline: the record queues, then goes once the network returns.
  link.offline = true;
  await capture(field, 'c2');
  expect(await deliver(field)).toMatchObject({ retried: 1 });
  link.offline = false;
  expect(await deliver(field)).toMatchObject({ accepted: 1 });

  // A record the hub refuses is completed as rejected and the device shows the hub's code.
  await capture(field, 'c3', 'reject');
  expect(await deliver(field)).toMatchObject({ rejected: 1 });
  expect((await captures(field)).captures.at(-1)).toEqual({
    id: 'c3',
    sync: 'rejected',
    code: 'INVALID_INPUT',
  });

  // Assignments flow the other way through the hub's inbound sync.
  await command('assignments.add', { title: 'Nameplates under =G1' });
  await field.instance.integrations.sync();
  expect((await captures(field)).assignments).toEqual(['Nameplates under =G1']);
});

test('a phone acts only through the sync operations, and not at all once revoked', async () => {
  const { hub, command, enrollment, api } = await startHub();
  const { field, pairing, token } = await openField();
  const paired = await pairing.pair({
    origin: hub.url,
    code: (await enrollment('field-sync')).code,
  });

  const inbound = await api(token(), '/api/v1/queries/assignments.inbound', { input: {} });
  expect(inbound.status).toBe(200);
  const add = await api(token(), '/api/v1/commands/assignments.add', {
    input: { title: 'Not from a phone' },
    idempotencyKey: 'phone-add',
  });
  expect(add.status).toBe(403);
  const list = await api(token(), '/api/v1/queries/link.device.list', { input: {} });
  expect(list.status).toBe(403);

  await command('link.device.revoke', { deviceId: paired.deviceId });
  const refused = await api(token(), '/api/v1/queries/assignments.inbound', { input: {} });
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: { details?: unknown } }).error.details).toEqual({
    credential: 'rejected',
  });

  // Records stay pending for a new pairing instead of being rejected.
  await capture(field, 'c1');
  expect(await deliver(field)).toMatchObject({ retried: 1 });
  expect((await effects(field))[0]!.lastFailure).toBe(
    'The peer did not accept this device credential; pair the device again',
  );
  const again = await pairing.pair({
    origin: hub.url,
    code: (await enrollment('field-sync')).code,
  });
  expect(again.deviceId).not.toBe(paired.deviceId);
  expect(await deliver(field)).toMatchObject({ accepted: 1 });
});

test('an attached tablet acts as the person who enrolled it, within the operations they chose', async () => {
  const { enrollment, redeem, api } = await startHub();
  const { code } = await enrollment('attached', ['captures.list', 'assignments.add']);
  const response = await redeem(code);
  expect(response.status).toBe(201);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const { token, device } = (await response.json()) as { token: string; device: { kind: string } };
  expect(device.kind).toBe('attached');

  const add = await api(token, '/api/v1/commands/assignments.add', {
    input: { title: 'From the tablet' },
    idempotencyKey: 'tablet-add',
  });
  expect(add.status).toBe(200);
  // Not in the enrollment's operations, although the person may do it.
  const enroll = await api(token, '/api/v1/commands/link.enrollment.create', {
    input: { label: 'Another', kind: 'field-sync' },
    idempotencyKey: 'tablet-enroll',
  });
  expect(enroll.status).toBe(403);
});

test('an attached tablet opens the hub screens with a launch key, and loses them once revoked', async () => {
  const { hub, command, enrollment } = await startHub();
  const { pairing, token } = await openField();
  await expect(pairing.launch()).rejects.toThrow('not paired');
  const { code } = await enrollment('attached', ['captures.list']);
  const paired = await pairing.pair({ origin: hub.url, code });
  expect(paired.kind).toBe('attached');

  // The tablet's hub screen: the device asks for a key with its credential, and the hub page
  // exchanges it for a cookie, as the web frame does on a `#launch=` link.
  const page = await pairing.launch();
  expect(page.origin).toBe(hub.url);
  const key = new URLSearchParams(new URL(page.url).hash.slice(1)).get('launch')!;
  const exchange = await fetch(`${hub.url}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: hub.url },
    body: JSON.stringify({ launch: key }),
  });
  expect(exchange.status).toBe(200);
  const cookie = exchange.headers.get('Set-Cookie')!.split(';')[0]!;
  expect(cookie).not.toContain(token());
  const reused = await fetch(`${hub.url}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: hub.url },
    body: JSON.stringify({ launch: key }),
  });
  expect(reused.status).toBe(403);

  const browser = (operation: string) =>
    fetch(`${hub.url}/api/v1/queries/${operation}`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: hub.url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
  expect((await browser('captures.list')).status).toBe(200);
  // The browser session has the device's operations, not the person's.
  expect((await browser('link.device.list')).status).toBe(403);

  const stream = await fetch(`${hub.url}/api/v1/events`, { headers: { Cookie: cookie } });
  const reader = stream.body!.getReader();
  expect((await reader.read()).done).toBe(false);

  await command('link.device.revoke', { deviceId: paired.deviceId });
  await expect(pairing.launch()).rejects.toThrow();
  const revoked = await browser('captures.list');
  expect(revoked.status).toBe(403);
  expect(((await revoked.json()) as any).error.details).toEqual({ credential: 'rejected' });
  // The stream ends at its next poll instead of following the journal for a revoked device.
  let done = false;
  while (!done) done = (await reader.read()).done;
});

test('enrollment codes are used once, expire after ten minutes, and guessing is throttled', async () => {
  const clock = { now: Date.now() };
  const { enrollment, redeem } = await startHub(clock);
  expect(deviceEnrollPath).toBe(enrollPath);

  const { code } = await enrollment('field-sync');
  expect((await redeem(code)).status).toBe(201);
  expect((await redeem(code)).status).toBe(403);

  const late = await enrollment('field-sync');
  clock.now += 10 * 60_000 + 1;
  expect((await redeem(late.code)).status).toBe(403);

  // The expired code was the first failure in a new window; it allows ten, then refuses even a
  // valid code until the window passes.
  const valid = await enrollment('field-sync');
  for (let attempt = 0; attempt < 9; attempt++)
    expect((await redeem(`WRONGCODE${attempt}`)).status).toBe(403);
  const throttled = await redeem(valid.code);
  expect(throttled.status).toBe(503);
  clock.now += 60_000;
  expect((await redeem(valid.code)).status).toBe(201);
});
