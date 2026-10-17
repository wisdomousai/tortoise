/**
 * Modules that must never reach the browser bundle: host runtimes, provider SDKs, credential
 * stores and the server-only framework packages (of `@agent-native/host`, only the manifests are
 * browser-safe). Shared by the static import scan and the Vite plugin that checks the real
 * browser dependency graph. Plugin packages are covered by `pluginBrowserEntry` and by the
 * resolved-path rule in `hostSourcePath`, so no plugin is named here.
 */
export const forbiddenBrowserImport =
  /^(?:node:|bun:|@agent-native\/(?:runtime|agents|adapters|integration|event-log|egress)(?:\/|$)|@agent-native\/station(?!\/requirements$)(?:\/|$)|@agent-native\/(?:host|kernel)(?!\/(?:manifest|plugin-manifest)$)(?:\/|$)|@agent-native\/devices\/server$|@anthropic-ai\/|@napi-rs\/|electron$|ai$)/;
/**
 * Every plugin in `plugins/*` follows one layout: `plugin-manifest`, `plugin-screens`,
 * `contracts` and the `ui/` and `components/` folders are browser code, at the package root or
 * under `src/`; everything else is server code.
 */
export const pluginBrowserSource =
  /^plugins\/[^/]+\/(?:src\/)?(?:(?:plugin-manifest|contracts)\.ts$|plugin-screens\.tsx$|(?:contracts|ui|components)\/)/;
/** The browser-safe subpaths of a plugin package, for `@agent-native/<plugin>/<subpath>`. */
export const pluginBrowserEntry = /^(?:plugin-manifest|plugin-screens|contracts)$/;
/** Resolved source paths of server-only framework and plugin packages. */
export const hostSourcePath =
  /(?:^|[\\/])packages[\\/](?:(?:agents|adapters|runtime|integration|event-log|egress)[\\/]src[\\/]|station[\\/]src[\\/](?!requirements\.ts$)|(?:host|kernel)[\\/]src[\\/](?!(?:manifest|plugin-manifest)\.ts$)|devices[\\/]src[\\/]server\.ts$)|^(?!.*[\\/]node_modules[\\/])(?:.*[\\/])?plugins[\\/][^\\/]+[\\/](?!(?:src[\\/])?(?:(?:plugin-manifest|contracts)(?:\.ts)?$|plugin-screens(?:\.tsx)?$|(?:contracts|ui|components)(?:[\\/]|$)))[^\\/]+(?:[\\/].*)?$/;

/**
 * Framework libraries the kernel (`packages/kernel`) and the Bun host (`packages/host`) must not
 * import. Egress and the event log are used by the site, network and audit plugins; an import
 * here would bring a policy or audit concept back into every application. Plugins themselves are a layer the framework never imports at all.
 */
export const kernelForbiddenImport =
  /^@agent-native\/(?:egress|event-log)(?:\/|$)|(?:^|\/)packages\/(?:egress|event-log)\//;

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
/**
 * Server source the egress rule applies to. Browser code (packages, the frame, content screens)
 * reaches only its own origin and cannot open sockets, so it is out of scope.
 */
export const serverSource =
  /^(?:apps\/(?:service|desktop)\/src\/|packages\/[^/]+\/src\/|plugins\/|examples\/)/;
export const browserSource =
  /^(?:packages\/(?:contracts|client|react|operator-ui|frame)\/|packages\/devices\/src\/(?!server\.ts$)|examples\/[^/]+\/(?:ui\/|screens\.tsx$))/;

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
  'packages/host/src/providers.ts':
    'Falls back to global fetch only when constructed without one; the host injects the guard.',
  'apps/desktop/src/service-lifecycle.ts':
    'The desktop shell starts its own authority sidecar, which listens on loopback.',
  'examples/line-station/station-bridge.ts':
    'Launches Chromium for the station screen and reads simulator counters; to be routed through the station-screen destination.',
  'packages/station/src/perception/worker.ts':
    'Starts the declared perception-worker process with an empty environment.',
  'packages/station/src/perception/openai-compatible-vision.ts':
    'Falls back to global fetch when no fetch is injected; to be made required so the host passes the guard.',
  'examples/line-station/fake-hmi/': 'Test fixture: the simulated station HMI and its recorder.',
};

/**
 * Source that runs on every platform, Hermes included: the kernel and the packages it composes,
 * the in-process transport, the portable event-log modules and the mobile starter. It must not
 * reach Node or Bun, nor a server-only package, so the mobile bundle never pulls one in.
 */
export const portableSource =
  /^(?:packages\/(?:contracts|runtime|client|integration|kernel)\/src\/|packages\/adapters\/src\/(?:application-port|direct-transport|sql-driver|snapshot-storage|exclusive-lock)\.ts$|packages\/event-log\/src\/(?:chain|memory|forward)\.ts$|packages\/mobile\/src\/|apps\/mobile\/(?:index\.ts$|src\/))/;
/** Imports portable source may not make: Node and Bun built-ins and the Bun-only packages. */
export const portableForbiddenImport =
  /^(?:node:|bun:|@agent-native\/(?:host|agents|egress|station)(?:\/|$)|@agent-native\/adapters(?!\/(?:application-port|direct-transport|sql-driver|snapshot-storage|exclusive-lock)$)(?:\/|$)|@agent-native\/event-log(?!\/(?:chain|memory|forward)$)(?:\/|$))/;
/** Node and Bun globals; React Native declares `process` too, so the type check alone misses it. */
export const nonPortableGlobal =
  /(?<![\w$.])(?:Bun|process|Buffer|__dirname|__filename|require)\s*[.(]/;
