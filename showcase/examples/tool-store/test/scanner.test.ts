import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScanRouter,
  createWedgeSource,
  defaultWedgeProfile,
  type RoutedScan,
  type ScanEvent,
  type ScannerProfile,
} from '@tortoise/devices';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';
import { counterProfile, counterRoutes, counterStation } from '../scanner';

/** The key a US keyboard sends for one character, as a wedge scanner types it. */
function keyFor(character: string) {
  if (/[A-Z]/.test(character)) return { key: character, code: `Key${character}`, shiftKey: true };
  if (/[a-z]/.test(character))
    return { key: character, code: `Key${character.toUpperCase()}`, shiftKey: false };
  if (/\d/.test(character)) return { key: character, code: `Digit${character}`, shiftKey: false };
  if (character === '-') return { key: '-', code: 'Minus', shiftKey: false };
  throw new Error(`No key for ${character}`);
}

/**
 * The counter's wedge source over a fake key target, routed with the counter's routes. `type`
 * sends a code as keys `gapMs` apart, then Enter.
 */
async function counter() {
  let listener: ((event: Event) => void) | undefined;
  const target = {
    addEventListener: (_: string, handle: (event: Event) => void) => (listener = handle),
    removeEventListener: () => (listener = undefined),
  } as unknown as Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  const router = createScanRouter(counterRoutes);
  const scans: { scan: ScanEvent; routed?: RoutedScan }[] = [];
  const stop = await createWedgeSource(counterProfile, target).start({
    onScan: (scan) => {
      const routed = router.route(scan);
      scans.push(routed ? { scan, routed } : { scan });
    },
  });
  let at = 1_000;
  const type = (code: string, gapMs = 5) => {
    for (const key of [...[...code].map(keyFor), { key: 'Enter', code: 'Enter', shiftKey: false }])
      listener?.({
        ...key,
        timeStamp: (at += gapMs),
        target: null,
        preventDefault() {},
      } as unknown as Event);
    at += 1_000;
  };
  return { type, scans, stop };
}

describe('counter scan routes', () => {
  test('an asset tag routes to the tool and a badge to the borrower', async () => {
    const { type, scans, stop } = await counter();
    type('TC-00042');
    type('E004217');
    stop();
    expect(scans.map(({ routed }) => routed && [routed.intent, routed.value])).toEqual([
      ['tool', 'TC-00042'],
      ['badge', 'E004217'],
    ]);
  });

  test('an unknown code is a scan with no route', async () => {
    const { type, scans, stop } = await counter();
    // A work order label, a short tag, a long badge, and a tag read without Shift.
    for (const code of ['WO-12345', 'TC-0042', 'E0042170', 'tc-00042']) type(code);
    stop();
    expect(scans.map(({ scan }) => scan.data)).toEqual([
      'WO-12345',
      'TC-0042',
      'E0042170',
      'tc-00042',
    ]);
    expect(scans.every(({ routed }) => routed === undefined)).toBe(true);
  });

  test('a person typing a tag and pressing Enter is no scan', async () => {
    const { type, scans, stop } = await counter();
    type('TC-00042', 120);
    stop();
    expect(scans).toEqual([]);
  });
});

const owner = { workspaceId: 'local', principalId: 'owner' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-scanner-'));
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({ members: { viewer: 'viewer', clerk: 'attendant' } }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}

const get = (station = counterStation) => ({
  operation: 'device.config.get',
  input: { station },
});
const save = (profile: ScannerProfile, station = counterStation) => ({
  operation: 'device.scanner.save',
  input: { station, profile },
  idempotencyKey: `save-${station}-${JSON.stringify(profile)}`,
});

describe('counter scanner configuration', () => {
  test('attendants configure the counter scanner, viewers read it, strangers reach neither', async () => {
    const app = await open();
    const fresh = await app.queryRaw(get(), viewer);
    expect(fresh.data).toEqual({ station: 'counter', revision: 0, scanners: [], routes: [] });

    const swiss: ScannerProfile = { ...counterProfile, scannerLayout: 'de-ch' };
    const saved = await app.invokeRaw(save(swiss), clerk);
    expect(saved.result).toMatchObject({ revision: 1, scanners: [swiss] });
    const read = await app.queryRaw(get(), viewer);
    expect((read.data as { scanners: unknown[] }).scanners).toEqual([swiss]);

    await expect(app.invokeRaw(save(counterProfile), viewer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(app.queryRaw(get(), stranger)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.invokeRaw(save(counterProfile), stranger)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('the counter is the only station', async () => {
    const app = await open();
    await expect(app.queryRaw(get('receiving'), owner)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      app.invokeRaw(save(defaultWedgeProfile(), 'receiving'), owner),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('saved routes replace the defaults and a stale writer conflicts', async () => {
    const app = await open();
    const routes = [...counterRoutes, { intent: 'work-order', pattern: '^WO-(\\d{5})$' }];
    await app.invokeRaw(
      {
        operation: 'device.routes.save',
        input: { station: counterStation, routes },
        idempotencyKey: 'routes-1',
      },
      owner,
    );
    const read = await app.queryRaw(get(), clerk);
    expect((read.data as { routes: unknown[] }).routes).toEqual(routes);
    await expect(
      app.invokeRaw(
        {
          operation: 'device.routes.save',
          input: { station: counterStation, routes: [] },
          idempotencyKey: 'routes-2',
          expectedRevisions: { 'device:counter': 0 },
        },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
