/// <reference types="uniwind/types" />

/** Written by `bun run mobile:prepare`; Metro maps the name to `generated/entry.ts`. */
declare module 'virtual:agent-native/mobile-entry' {
  import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
  import type { NativeApplicationScreens } from '@agent-native/frame-native/screens';

  const entry: { application: AnyApplicationDefinition; screens: NativeApplicationScreens };
  export default entry;
}

declare module '*.css';
