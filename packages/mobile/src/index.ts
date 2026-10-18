/**
 * The mobile host platform, without any Expo or React Native import, so Bun tests can open the
 * same instance with Bun bindings. The device bindings are in `@agent-native/mobile/expo`.
 */
export { createMobilePlatform, type MobileBindings } from './platform';
export { openMobileInstance, type MobileInstance, type MobileInstanceOptions } from './instance';
export { requirePluginNativeModule, type NativeModuleLookup } from './native-module';
export { connectMobileShell, type MobileOsBindings, type MobileOsConnection } from './os';
