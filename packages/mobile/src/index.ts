/**
 * The mobile host platform, without any Expo or React Native import, so Bun tests can open the
 * same authority with Bun bindings. The device bindings are in `@agent-native/mobile/expo`.
 */
export { createMobilePlatform, type MobileBindings } from './platform';
export {
  openMobileAuthority,
  type MobileAuthority,
  type MobileAuthorityOptions,
} from './authority';
