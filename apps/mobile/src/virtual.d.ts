/// <reference types="uniwind/types" />

/** Written by `bun run mobile:prepare`; Metro maps the name to `generated/entry.ts`. */
declare module 'virtual:agent-native/mobile-entry' {
  import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
  import type { NativeApplicationScreens } from '@agent-native/frame-native/screens';

  const entry: {
    application: AnyApplicationDefinition;
    screens: NativeApplicationScreens;
    /** The starter's identity as the app needs it at runtime. */
    identity: { scheme: string };
    /** Launcher settings the identity implies, for the composed plugins that declare them. */
    settings: Readonly<Record<string, string>>;
  };
  export default entry;
}

declare module '*.css';
