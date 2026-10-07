/**
 * Modules that must never reach the browser bundle: host runtimes, provider SDKs, credential
 * stores and the server-only framework packages (of `@agent-native/host`, only the manifest is
 * browser-safe). Shared by the static import scan and the Vite
 * plugin that checks the real browser dependency graph.
 */
export const forbiddenBrowserImport =
  /^(?:node:|bun:|@agent-native\/(?:runtime|agents|adapters|integration|station)(?:\/|$)|@agent-native\/host(?!\/manifest$)(?:\/|$)|@agent-native\/devices\/server$|@anthropic-ai\/|@napi-rs\/|electron$|ai$)/;
/** Resolved source paths of server-only framework packages. */
export const hostSourcePath =
  /(?:^|[\\/])packages[\\/](?:(?:agents|adapters|runtime|integration|station)[\\/]src[\\/]|host[\\/]src[\\/](?!manifest\.ts$)|devices[\\/]src[\\/]server\.ts$)/;
