import { expect, test } from 'bun:test';
import { definePluginNativeScreens } from '../src/plugin-screens';
import {
  defineNativeScreens,
  nativeScreenForCapability,
  type NativeScreenRoute,
} from '../src/screens';

const Screen = () => null;
const Icon = () => null;
const route = (path: string): NativeScreenRoute => ({ path, component: Screen });

const base = {
  home: '/captures',
  routes: [route('/captures'), route('/captures/detail'), route('/tree')],
  navigation: [
    { to: '/captures', label: 'Captures', icon: Icon },
    { to: '/tree', label: 'Tree', icon: Icon },
  ],
  capabilityScreens: [
    { prefix: 'capture.', to: '/captures' },
    { prefix: 'capture.detail', to: '/captures/detail' },
  ],
};

test('plugin screens merge after the application and the longest prefix wins', () => {
  const pairing = definePluginNativeScreens({
    id: 'device-link',
    routes: [route('/pairing')],
    navigation: [{ to: '/pairing', label: 'Pairing', icon: Icon }],
    capabilityScreens: [{ prefix: 'device.', to: '/pairing' }],
  });
  const screens = defineNativeScreens({ ...base, plugins: [pairing] });
  expect(screens.navigation.map((item) => item.to)).toEqual(['/captures', '/tree', '/pairing']);
  expect(nativeScreenForCapability(screens, 'capture.detail.read')).toBe('/captures/detail');
  expect(nativeScreenForCapability(screens, 'capture.record')).toBe('/captures');
  expect(nativeScreenForCapability(screens, 'device.revoke')).toBe('/pairing');
  expect(nativeScreenForCapability(screens, 'other.op')).toBeUndefined();
});

test('dead links, duplicates and a home that is not a tab fail at definition time', () => {
  expect(() => defineNativeScreens({ ...base, routes: [...base.routes, route('/tree')] })).toThrow(
    'Screen "/tree" is declared twice',
  );
  expect(() =>
    defineNativeScreens({ ...base, capabilityScreens: [{ prefix: 'x.', to: '/missing' }] }),
  ).toThrow('Screen target "/missing" has no screen');
  expect(() => defineNativeScreens({ ...base, home: '/captures/detail' })).toThrow(
    'Home "/captures/detail" is not a tab',
  );
  expect(() =>
    defineNativeScreens({
      ...base,
      navigation: [...base.navigation, { to: '/tree', label: 'Again', icon: Icon }],
    }),
  ).toThrow('Screen "/tree" is a tab twice');
  // A plugin screen that collides with the application's is caught too.
  expect(() =>
    defineNativeScreens({
      ...base,
      plugins: [definePluginNativeScreens({ id: 'p', routes: [route('/tree')] })],
    }),
  ).toThrow('declared twice');
});
