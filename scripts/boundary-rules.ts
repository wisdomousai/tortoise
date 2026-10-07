/**
 * Modules that must never reach the browser bundle: host runtimes, provider SDKs, credential
 * stores and the server-only framework packages. Shared by the static import scan and the Vite
 * plugin that checks the real browser dependency graph.
 */
export const forbiddenBrowserImport =
  /^(?:node:|bun:|@agent-native\/(?:runtime|agents|adapters|integration|station|event-log|egress)(?:\/|$)|@agent-native\/assurance(?:$|\/(?!contracts$))|@agent-native\/devices\/server$|@anthropic-ai\/|@napi-rs\/|electron$|ai$)/;
/** Resolved source paths of server-only framework packages. */
export const hostSourcePath =
  /(?:^|[\\/])packages[\\/](?:(?:agents|adapters|runtime|integration|station|event-log|egress)[\\/]src[\\/]|assurance[\\/]src[\\/](?!contracts\.ts$)|devices[\\/]src[\\/]server\.ts$)/;

/**
 * Direct network and process APIs. Server code reaches other hosts only through
 * `@agent-native/egress`, so every connection is declared, bound by the site policy and audited.
 * A match outside `egressExemptions` fails `check:boundaries`.
 */
export const directEgress: readonly { readonly api: string; readonly pattern: RegExp }[] = [
  {
    api: 'global fetch',
    pattern: /(?<![\w$.])fetch\s*\(|(?:\?\?|\|\|)\s*(?:globalThis\.)?fetch\b|globalThis\.fetch\b/,
  },
  { api: 'Bun.connect', pattern: /\bBun\.connect\b/ },
  { api: 'Bun.spawn', pattern: /\bBun\.spawn(?:Sync)?\b/ },
  { api: 'WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  {
    api: 'socket or process module',
    pattern:
      /(?:from\s*|import\s*\(\s*)['"](?:node:)?(?:http|https|http2|dgram|tls|child_process)['"]/,
  },
  // Address parsing from node:net is fine; sockets are not.
  {
    api: 'node:net sockets',
    pattern:
      /import\s+(?!\{\s*(?:type\s+)?isIP(?:v4|v6)?(?:\s*,\s*(?:type\s+)?isIP(?:v4|v6)?)*\s*,?\s*\})[^;]*?from\s*['"](?:node:)?net['"]/,
  },
];
/** Server source the egress rule applies to. Browser packages cannot open sockets at all. */
export const serverSource =
  /^(?:apps\/(?:service|desktop)\/src\/|packages\/[^/]+\/src\/|examples\/)/;
export const browserSource =
  /^(?:packages\/(?:contracts|client|react|operator-ui)\/|packages\/devices\/src\/(?!server\.ts$))/;

/**
 * Reviewed exceptions, each with the reason it is safe. Keep this list short: it is what an
 * auditor reads to see every path that does not pass through the egress guard. A listed path
 * that no longer matches is reported, so the list cannot go stale.
 */
export const egressExemptions: Readonly<Record<string, string>> = {
  'packages/egress/src/': 'The egress guard, socket client and CONNECT proxy themselves.',
  'packages/agents/src/process.ts':
    'Launches declared harness processes; the host passes the proxy environment for the process ID.',
  'packages/agents/src/claude.ts':
    'Spawns the declared claude-code process for the Agent SDK with the proxy environment.',
  'packages/agents/src/chatgpt.ts':
    'Falls back to global fetch only when constructed without one; the host injects the guard.',
  'packages/agents/src/oidc.ts':
    'Falls back to global fetch only when constructed without one; the host injects the guard.',
  'apps/service/src/providers.ts':
    'Falls back to global fetch only when constructed without one; the host injects the guard.',
  'apps/desktop/src/service-lifecycle.ts':
    'The desktop shell starts its own authority sidecar, which listens on loopback.',
  'apps/service/src/station-bridge.ts':
    'Launches Chromium for the station screen and reads simulator counters; to be routed through the station-screen destination.',
  'packages/station/src/perception/worker.ts':
    'Starts the declared perception-worker process with an empty environment.',
  'packages/station/src/perception/openai-compatible-vision.ts':
    'Falls back to global fetch when no fetch is injected; to be made required so the host passes the guard.',
  'examples/line-station/fake-hmi/': 'Test fixture: the simulated station HMI and its recorder.',
};
