import { expect, test } from 'bun:test';
import { defineFeatureScreens } from '../src/feature-screens';
import { definePluginScreens } from '../src/plugin-screens';
import { defineScreens, screenForCapability, type ScreenRoute } from '../src/screens';

const Screen = () => null;
const Icon = () => null;
const route = (path: string): ScreenRoute => ({ path, component: Screen });

const base = {
  home: '/tasks',
  routes: [route('/tasks')],
  navigation: [{ to: '/tasks', label: 'Tasks', icon: Icon }],
  capabilityScreens: [{ prefix: 'task.', to: '/tasks' }],
};
const approvals = defineFeatureScreens({
  id: 'approval',
  routes: [route('/approvals')],
  navigation: [{ to: '/approvals', label: 'Approvals', icon: Icon }],
  capabilityScreens: [{ prefix: 'approval.', to: '/approvals' }],
});
const webhook = definePluginScreens({
  id: 'webhook',
  routes: [route('/webhook')],
  capabilityScreens: [{ prefix: 'webhook.', to: '/webhook' }],
});
const manifest = { features: [{ id: 'approval' }], plugins: [{ id: 'webhook' }] };

test('feature screens merge after the application and before plugins', () => {
  const screens = defineScreens({ ...base, manifest, features: [approvals], plugins: [webhook] });
  expect(screens.routes.map((entry) => entry.path)).toEqual(['/tasks', '/approvals', '/webhook']);
  expect(screenForCapability(screens, 'approval.approve')).toBe('/approvals');
  expect(screenForCapability(screens, 'webhook.receive')).toBe('/webhook');
});

test('unit screens the manifest does not compose, out of order or outside the namespace fail', () => {
  expect(() => defineScreens({ ...base, features: [approvals] })).toThrow(
    'Feature and plugin screens need the application manifest',
  );
  expect(() =>
    defineScreens({ ...base, manifest: { plugins: manifest.plugins }, features: [approvals] }),
  ).toThrow('Feature screens "approval" have no feature in the manifest');
  const other = definePluginScreens({ id: 'compliance', routes: [route('/compliance')] });
  expect(() =>
    defineScreens({
      ...base,
      manifest: { plugins: [{ id: 'webhook' }, { id: 'compliance' }] },
      plugins: [other, webhook],
    }),
  ).toThrow('Plugin screens "webhook" are out of the manifest\'s order');
  expect(() =>
    defineScreens({
      ...base,
      manifest,
      features: [{ ...approvals, capabilityScreens: [{ prefix: 'task.', to: '/approvals' }] }],
    }),
  ).toThrow('Feature screens "approval" open "task.", which is outside the namespace "approval."');
});
