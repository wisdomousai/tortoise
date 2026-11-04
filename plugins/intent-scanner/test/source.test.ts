import { expect, test } from 'bun:test';
import type { ScanEvent } from '@tortoise/devices/scanner/decode';
import {
  defaultWedgeProfile,
  scannerProfileSchema,
  type ScannerProfile,
} from '@tortoise/devices/scanner/profile';
import { intentScannerPluginManifest } from '../src/plugin-manifest';
import { createIntentSource, type IntentScannerModule } from '../src/source';

/** The native module as the receiver drives it; `broadcast` stands in for the scanner app. */
function fakeModule() {
  const listeners = new Set<(scan: { action: string; text: string }) => void>();
  const listening = new Map<string, string | null>();
  const module: IntentScannerModule = {
    listen: (action, _dataExtra, permission) => void listening.set(action, permission),
    stop: (action) => void listening.delete(action),
    addListener: (_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    module,
    listening,
    broadcast(action: string, text: string) {
      for (const listener of listeners) listener({ action, text });
    },
  };
}

const profile: ScannerProfile = scannerProfileSchema.parse({
  ...defaultWedgeProfile('datawedge', 'DataWedge'),
  transport: 'intent',
  aimIds: true,
  intent: {
    action: 'dev.tortoise.SCAN',
    dataExtra: 'com.symbol.datawedge.data_string',
    senderPermission: 'com.symbol.datawedge.permission.SEND',
  },
});

test('broadcasts for the profile action decode like any other source', async () => {
  const device = fakeModule();
  const scans: ScanEvent[] = [];
  const stop = await createIntentSource(profile, device.module).start({
    onScan: (scan) => scans.push(scan),
  });
  expect(device.listening.get('dev.tortoise.SCAN')).toBe('com.symbol.datawedge.permission.SEND');
  device.broadcast('dev.tortoise.SCAN', ']C1(01)09506000134352(10)LOT7');
  device.broadcast('other.app.SCAN', 'ignored');
  expect(scans).toHaveLength(1);
  expect(scans[0]).toMatchObject({
    source: 'intent',
    profileId: 'datawedge',
    symbology: 'gs1-128',
  });
  expect(scans[0]!.gs1?.valid).toBe(true);
  stop();
  expect(device.listening.size).toBe(0);
  device.broadcast('dev.tortoise.SCAN', 'after stop');
  expect(scans).toHaveLength(1);
});

test('without the native receiver or an intent the source is unsupported', async () => {
  expect(createIntentSource(profile, null).isSupported()).toBe(false);
  await expect(createIntentSource(profile, null).start({ onScan: () => {} })).rejects.toThrow(
    'intent scanner unsupported: no native intent receiver',
  );
  const bare = { ...profile, intent: undefined };
  expect(createIntentSource(bare, fakeModule().module).isSupported()).toBe(false);
});

test('profiles refuse actions and extras that are not Android names', () => {
  const parse = (intent: object) =>
    scannerProfileSchema.safeParse({ ...profile, intent: { ...profile.intent, ...intent } })
      .success;
  expect(parse({ action: 'not an action' })).toBe(false);
  expect(parse({ dataExtra: '../data' })).toBe(false);
  expect(parse({ senderPermission: 'x' })).toBe(false);
});

test('the plugin runs on Android only and names its native module', () => {
  expect(intentScannerPluginManifest.platforms).toEqual(['android']);
  expect(intentScannerPluginManifest.native).toEqual({ module: 'TortoiseIntentScanner' });
});
