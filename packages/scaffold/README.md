# @agent-native/scaffold

Exports the framework, the starter and content as a standalone application in a new directory, and generates new applications and their parts. The export carries a versioned file-hash manifest, installs with the pinned lockfile and passes its own checks. With `--example <name>` it exports one example as the hosted application, together with the examples it imports (a field app keeps the hub whose domain modules it shares), and leaves the other examples, their reference sets, root dependencies and lockfile entries out. `new` exports no example and generates one application in `examples/<name>` instead; with `--published` or `--registry <url>` it leaves the framework source out and depends on the framework packages at the checkout's version. `add` extends that application with a collection, a capability or a target. `versions` checks that an installed application has one framework version.

Layer: framework (`packages/*`). Server-side CLI.

## Primitives

- [Scaffold](../../docs/primitives.md#scaffold): `scaffold`, `scaffoldNew`, `scaffoldAdd`, `ScaffoldOptions`, `ScaffoldManifest`, `NewOptions`, `AddRequest`, `AddOptions`.
- [Framework release](../../docs/primitives.md#framework-release): `installedFramework`, the check behind `bun run check:framework`.

Generated applications use [Collection](../../docs/primitives.md#collection), [Policy](../../docs/primitives.md#policy), [Target](../../docs/primitives.md#target) and the frame's `collection-screen` [UI registry](../../docs/primitives.md#ui-registry) item. The root [README](../../README.md#create-another-app) shows the export flow, and the [setup skill](../../skills/create-agent-native-app/SKILL.md) guides an agent through both. An export carries every skill in `skills/` and in workspace `skills/` directories, but not the `.claude/skills` and `.agents/skills` links; run `bun run skills:link` in the new checkout.

## Entrypoints

| Import                     | Runs in     | Contents                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/scaffold`   | server only | `scaffold(options)`, `scaffoldNew(options)`, `scaffoldAdd(request, options)`, `installedFramework(root)`, `appNames`, `displayNameOf` and their option and result types.                                                                                                                                                                                                      |
| `@agent-native/scaffold/*` | server only | One source file: `scaffold`, `new`, `add`, `file-rules` (what is exported), `examples` (example pruning), `published` (an export over installed framework versions), `versions` (the installed-version check), `json` (JSON as Prettier writes it), `content` (adding the generated workspace to the root manifest and `bun.lock`), `apply` (applying a generated part in memory), `markers` (inserting at `// scaffold:<list>` markers) or `cli`. Part generators are in `src/templates/`. |

From the command line (`src/cli.ts`):

```sh
bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]
bun run scaffold new <absent-target-directory> --name <app-name> [--display-name <label>] [--collection <type>] [--published | --registry <url>]
bun run scaffold add collection <type> [--app <directory>]
bun run scaffold add capability <operation-id> --kind command|query --description <text> [--app <directory>]
bun run scaffold add target <name> --collection <type> [--app <directory>]
bun run scaffold versions [<application-directory>]
```

With `--published` or `--registry <url>`, `new` leaves `packages/*`, `plugins/*`, `sdks/*`, the lockfile and the release scripts out. The root manifest depends on every framework package at the checkout's framework version, the workspaces are `apps/*` and `examples/*`, root scripts that test or release framework source are dropped (and removed from chains such as `check`), and the starter's relative references to framework files (tsconfig paths, stylesheets, README links) point into `node_modules`. `--registry` writes a `bunfig.toml` that installs the `@agent-native` scope from that URL. The first `bun install` writes the lockfile; commit it. Only `new` supports this, because the examples' own tests read plugin and SDK source by path.

`add target` also lists the target's destination as disabled in `apps/desktop/site-policy.json`, so `site check` passes until someone binds it to the system of record's URL.

`add` works on the hosted application unless `--app` names another directory. It starts no processes; run `bun run format && bun run generate` afterwards.

The application skeleton is a set of `.tpl` files in `templates/application`, rendered with `{{name}}` placeholders; a placeholder without a value throws. They are text rather than code so the boundary check does not read the skeleton's plugin imports as the scaffold's own. Parts are generated by functions in `src/templates/` because they differ by kind (a command or a query, a target's collection).

A generated application keeps `// scaffold:<list>` comments in its operations, handlers, policy rules, lanes, state, options, integrations, routes and navigation. `add` inserts on the lines before the marker, so the marker stays last. It refuses an application without its manifest and policy, a part whose file already exists and a file without the marker it needs, and writes nothing unless every file is produced.

## Trust boundary

The scaffold copies source only. It refuses to overwrite an existing target and refuses a target inside the source checkout. It skips workspace data, build output, connection and session files, `.env*` files and anything named like a secret, credential, token or private key, so no credentials or workspace data leave the checkout. Source files are text and are rewritten for the new name; PNG and JPEG images, such as test fixtures and golden screenshots, are copied byte for byte. The application name must be a lowercase npm-style name, and the display name single-line text without `*/`. Files are staged and moved into place only when the export completes. `add` edits only files of the application it was pointed at.

A generated application lists the site, network, audit and compliance plugins and gives each target an integration principal with its own lane and no role. Commands are for editors and reads for members; adjust `policy.ts` before adding people.

`versions` reads package manifests under `node_modules` only. A published-framework export trusts the configured registry for the `@agent-native` scope as it trusts npm for other packages; the lockfile then pins each tarball's integrity.

Gaps: an example export always copies the framework. `add agent` is not implemented.

## Dependencies

Framework: `@agent-native/contracts` (canonical JSON for the manifest). Node: filesystem and `node:crypto`.

## Tests

```sh
bun run test:scaffold
bun run test:scaffold:full   # the export flows, and a new application installed from a loopback registry
```

`src/scaffold.test.ts` covers deterministic export, private and runtime artifacts left out, images copied unchanged, single-example selection with the examples it imports, and rejection of checkout-specific paths. `src/generate.test.ts` covers `new` (one generated workspace, root dependency and lockfile entries, no example copied), `add` of each kind at the markers, refusals, marker insertion, lockfile ordering and template rendering. The full acceptance runs are opt-in (`SCAFFOLD_ACCEPTANCE=1`) so an exported test cannot export itself recursively. The generated application's acceptance run adds a collection, a capability and a target, then runs format, generate, typecheck, build, its tests and its Playwright spec of the default screens. The registry run packs the framework, serves it on loopback, exports with `--registry`, installs, reinstalls with `--frozen-lockfile` from a clean `node_modules`, adds a target and runs the application's whole `check` and its Playwright spec. `src/versions.test.ts` covers the mixed-version refusal.
