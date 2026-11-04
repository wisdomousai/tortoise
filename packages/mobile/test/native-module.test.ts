import { expect, test } from 'bun:test';
import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { requirePluginNativeModule, type NativeModuleLookup } from '../src/index';

const scanner = definePluginManifest({
  id: 'scanner',
  title: 'Scanner',
  platforms: ['android'],
  native: { module: 'AgentNativeScanner' },
});

test('a plugin finds its native module by the name its manifest gives', () => {
  const module = { listen() {} };
  const lookup = ((name: string) =>
    name === 'AgentNativeScanner' ? module : null) as NativeModuleLookup;
  expect(requirePluginNativeModule<typeof module>(scanner, lookup)).toBe(module);
});

test('a build without the module, or a manifest without one, refuses with the reason', () => {
  const missing = (() => null) as NativeModuleLookup;
  expect(() => requirePluginNativeModule(scanner, missing)).toThrow(
    'Plugin "scanner" needs the native module "AgentNativeScanner", which this build does not include; run bun run mobile:prebuild and rebuild',
  );
  const plain = definePluginManifest({ id: 'plain', title: 'Plain', platforms: ['android'] });
  expect(() => requirePluginNativeModule(plain, missing)).toThrow(
    'Plugin "plain" declares no native module',
  );
});
