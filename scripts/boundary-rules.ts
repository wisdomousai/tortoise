/**
 * Modules that must never reach the browser bundle: host runtimes, provider SDKs, credential
 * stores and the server-only framework packages (of `@tortoise/host`, only the manifests are
 * browser-safe). Shared by the static import scan and the Vite plugin that checks the real
 * browser dependency graph. Plugin packages are covered by `pluginBrowserEntry` and by the
 * resolved-path rule in `hostSourcePath`, so no plugin is named here.
 */
export const forbiddenBrowserImport =
  /^(?:node:|bun:|@tortoise\/(?:runtime|agents|adapters|integration|event-log|observation)(?:\/|$)|@tortoise\/screen-bridge(?!\/requirements$)(?:\/|$)|@tortoise\/(?:host|kernel)(?!\/(?:manifest|plugin-manifest)$)(?:\/|$)|@tortoise\/devices\/server$|@tortoise\/assignments\/server(?:\/|$)|@anthropic-ai\/|@napi-rs\/|electron$|ai$)/;
/**
 * Every plugin in `plugins/*` follows one layout: `plugin-manifest`, `plugin-screens`,
 * `contracts` and the `ui/` and `components/` folders are browser code, at the package root or
 * under `src/`; everything else is server code. A pattern's own plugin, in
 * `showcase/patterns/<name>/plugins/<plugin>`, follows the same layout.
 */
export const pluginBrowserSource =
  /^(?:(?:showcase\/patterns\/[^/]+\/)?plugins\/[^/]+|workstations\/sign-in)\/(?:src\/)?(?:(?:plugin-manifest|contracts)\.ts$|plugin-screens\.tsx$|(?:contracts|ui|components)\/)/;
/** The browser-safe subpaths of a plugin package, for `@tortoise/<plugin>/<subpath>`. */
export const pluginBrowserEntry = /^(?:plugin-manifest|plugin-screens|contracts)$/;
/** Resolved source paths of server-only framework and plugin packages. */
export const hostSourcePath =
  /(?:^|[\\/])packages[\\/](?:(?:agents|adapters|runtime|integration|event-log|observation)[\\/]src[\\/]|(?:host|kernel)[\\/]src[\\/](?!(?:manifest|plugin-manifest)\.ts$)|devices[\\/]src[\\/]server\.ts$|assignments[\\/]src[\\/]server[\\/])|(?:^|[\\/])workstations[\\/]screen-bridge[\\/]src[\\/](?!requirements\.ts$)|^(?!.*[\\/]node_modules[\\/])(?:.*[\\/])?(?:plugins[\\/][^\\/]+|workstations[\\/]sign-in)[\\/](?!(?:src[\\/])?(?:(?:plugin-manifest|contracts)(?:\.ts)?$|plugin-screens(?:\.tsx)?$|(?:contracts|ui|components)(?:[\\/]|$)))[^\\/]+(?:[\\/].*)?$/;

/**
 * Framework libraries the composition (`packages/kernel`) and the Bun host (`packages/host`) must not
 * import. The event log is used by the audit plugin; an import here would bring an audit concept
 * back into every application. Plugins themselves are a layer the framework never imports at all.
 */
export const kernelForbiddenImport = /^@tortoise\/event-log(?:\/|$)|(?:^|\/)packages\/event-log\//;

/**
 * Direct network and process APIs. Server code reaches other hosts only through
 * the network port, whose guard is in `plugins/network`, so every connection is declared, bound by the deployment policy and audited.
 * A match outside `networkExemptions` fails `check:boundaries`.
 */
export const directNetwork: readonly { readonly api: string; readonly pattern: RegExp }[] = [
  {
    api: 'global fetch',
    pattern: /(?<![\w$.])fetch\s*\(|(?:\?\?|\|\|)\s*(?:globalThis\.)?fetch\b|globalThis\.fetch\b/,
  },
  { api: 'Bun.connect', pattern: /\bBun\.connect\b/ },
  { api: 'Bun.spawn', pattern: /\bBun\.spawn(?:Sync)?\b/ },
  { api: 'Bun.SQL', pattern: /\bBun\.SQL\b|import\s*\{[^}]*\bSQL\b[^}]*\}\s*from\s*['"]bun['"]/ },
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
 * Server source the network rule applies to. Browser code (packages, the frame, content screens)
 * reaches only its own origin and cannot open sockets, so it is out of scope.
 */
export const serverSource =
  /^(?:apps\/(?:service|desktop)\/src\/|packages\/[^/]+\/src\/|plugins\/|workstations\/|showcase\/)/;
export const browserSource =
  /^(?:packages\/(?:contracts|client|react|operator-ui|frame)\/|packages\/devices\/src\/(?!server\.ts$)|packages\/assignments\/src\/(?!server\/)|showcase\/(?:examples|patterns)\/[^/]+\/(?:ui\/|screens\.tsx$))/;

/**
 * Reviewed exceptions, each with the reason it is safe. Keep this list short: it is what an
 * auditor reads to see every path that does not pass through the network guard. A listed path
 * that no longer matches is reported, so the list cannot go stale.
 */
export const networkExemptions: Readonly<Record<string, string>> = {
  'plugins/network/src/guard': 'The network guard and its socket client themselves.',
  'plugins/network/src/proxy.ts': 'The CONNECT proxy for declared child processes.',
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
    'The desktop shell starts its own instance sidecar, which listens on loopback.',
  'apps/desktop/src/os-shell.ts':
    'The desktop shell submits OS requests to and polls OS actions from its loopback instance.',
  'showcase/examples/winding-line/station-bridge.ts':
    "Launches Chromium for the workstation application's screen and reads simulator counters; to be routed through the screen-bridge destination.",
  'packages/host/src/cli/runs-command.ts':
    'Operator verb only, never inside an instance: `runs` calls the run route of the loopback instance its connection file names.',
  'packages/testing/src/agent-scenarios.ts':
    'Test tooling only: with `AGENT_SCENARIOS=live`, the scenario harness reaches the model server at a loopback `AGENT_SCENARIOS_URL` and refuses any other address.',
  'plugins/site/src/install/native.ts':
    'Operator verbs only, never inside an instance: `app install` runs the release it placed (network export, migrate), `app uninstall --purge` runs its `drain`, and, with --apply, the OS service manager and firewall loader.',
  'plugins/execution-host/src/relay.ts':
    "Forwards a sandbox's unix socket to one fixed loopback port: the host's own API listener or the network CONNECT proxy, which applies the destination rules.",
  'plugins/execution-host/sandbox/':
    'Runs only inside a bubblewrap sandbox, whose network namespace has loopback only: the launcher relays loopback ports to the host relays and starts the task.',
  'plugins/execution-host/test/fixtures/':
    'Test fixture run inside the sandbox: it attempts the connections and processes the sandbox must refuse.',
  'plugins/model-server/src/testing/':
    'Stand-in for llama-server in tests and development launches, started as a child through the process port: it listens on the loopback port the site policy binds to local-inference.',
  'packages/adapters/src/postgres-bun.ts':
    "The hosted platform's workspace database, opened before any plugin from the URL the launcher configures; it holds workspace state, as the local SQLite file does.",
  'plugins/process/src/spawn.ts':
    'Starts declared child processes from site-policy bindings with a built environment; the process port is the only caller.',
  'workstations/screen-bridge/src/recognition/openai-compatible-vision.ts':
    'Falls back to global fetch when no fetch is injected; to be made required so the host passes the guard.',
  'showcase/examples/winding-line/fake-hmi/':
    'Test fixture: the simulated workstation application and its recorder.',
  'showcase/examples/asset-survey-field/test/fixtures.ts':
    "Test fixture: the phone's fetch to the loopback hub, which a test drops or alters as a lost network or a newer hub release would.",
  'plugins/fleet-agent/src/relay.ts':
    "Forwards a remote-access request from the fleet to the host's own listener (`PluginStartContext.origin`) under `/api/v1/` only, adding no credential and never following a redirect.",
  'plugins/hub-link/src/plugin.ts':
    'Provides the network port on a paired device, where no network guard runs: one destination, the paired hub origin over https (http on loopback only), redirects refused; the enrollment exchange posts to the origin being paired.',
};

/**
 * Source that runs on every platform, Hermes included: the kernel and the packages it composes,
 * the in-process transport, the portable event-log modules, the native frame, the mobile
 * starter and an example's native screens (`screens-native.tsx`, `ui-native/`). It must not
 * reach Node or Bun, nor a server-only package, so the mobile bundle never pulls one in.
 */
export const portableSource =
  /^(?:packages\/(?:contracts|runtime|client|integration|kernel|frame-native|shell|assignments)\/src\/|packages\/react\/src\/query(?:\.ts$|\/)|packages\/devices\/src\/scanner\/(?:decode|profile|source|gs1|symbology|layouts)\.ts$|packages\/adapters\/src\/(?:application-port|direct-transport|sql-driver|snapshot-storage|schema-version|exclusive-lock)\.ts$|packages\/event-log\/src\/(?:chain|memory|forward)\.ts$|packages\/mobile\/src\/|apps\/mobile\/(?:index\.ts$|src\/|fixture\/)|(?:examples|patterns)\/[^/]+\/(?:screens-native\.tsx$|ui-native\/))/;
/** Imports portable source may not make: Node and Bun built-ins and the Bun-only packages. */
export const portableForbiddenImport =
  /^(?:node:|bun:|@tortoise\/(?:host|agents|station)(?:\/|$)|@tortoise\/(?:site|network)(?!\/(?:plugin-manifest|plugin-screens|contracts)$)(?:\/|$)|@tortoise\/adapters(?!\/(?:application-port|direct-transport|sql-driver|snapshot-storage|exclusive-lock)$)(?:\/|$)|@tortoise\/event-log(?!\/(?:chain|memory|forward)$)(?:\/|$))/;
/** Node and Bun globals; React Native declares `process` too, so the type check alone misses it. */
export const nonPortableGlobal =
  /(?<![\w$.])(?:Bun|process|Buffer|__dirname|__filename|require)\s*[.(]/;
