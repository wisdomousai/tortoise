# @agent-native/scaffold

The [scaffold](../../docs/glossary.md#scaffold) exports the [framework](../../docs/glossary.md#framework), the [starter](../../docs/glossary.md#starter) and content as a standalone [application](../../docs/glossary.md#application) in a new directory. It also generates new applications and their parts. An export carries a versioned file-hash manifest, installs with the pinned lockfile and passes its own checks.

## Layer

Framework (`packages/*`). Server-side CLI. The scaffold trusts the source checkout it copies from and, for a published-framework export, the configured registry.

## Primitives

- [Scaffold](../../docs/primitives.md#scaffold): `scaffold`, `scaffoldNew`, `scaffoldAdd`, `ScaffoldOptions`, `ScaffoldManifest`, `NewOptions`, `AddRequest`, `AddOptions`.
- [Framework release](../../docs/primitives.md#framework-release): `installedFramework`, the check behind `bun run check:framework`.

Generated applications use [Collection](../../docs/primitives.md#collection), [Policy](../../docs/primitives.md#policy), [Target](../../docs/primitives.md#target) and the frame's `collection-screen` [UI registry](../../docs/primitives.md#ui-registry) item. [Getting started](../../docs/getting-started.md#new-application) shows the export flow, and the [setup skill](skills/create-agent-native-app/SKILL.md) guides an agent through both.

Skills live in each package's `skills/` directory and travel with it. A source export copies them, and an installed-framework export gets them from the installed packages. Neither carries the `.claude/skills` and `.agents/skills` links, which `bun install` writes in the new checkout.

## Entrypoints

| Import                     | Runs in     | Contents                                                                                    |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `@agent-native/scaffold`   | server only | `scaffold`, `scaffoldNew`, `scaffoldAdd`, `installedFramework`, `appNames`, `displayNameOf` and their types. |
| `@agent-native/scaffold/*` | server only | One source file from `src/`, listed below.                                                  |

The signatures are `scaffold(options)`, `scaffoldNew(options)`, `scaffoldAdd(request, options)` and `installedFramework(root)`. The source files are:

- `scaffold`, `new`, `add` and `cli`;
- `file-rules`: what is exported;
- `examples`: example pruning;
- `published`: an export over installed framework versions;
- `versions`: the installed-version check;
- `json`: JSON as Prettier writes it;
- `content`: adding the generated package to the root manifest and `bun.lock`;
- `apply`: applying a generated part in memory;
- `markers`: inserting at `// scaffold:<list>` markers.

Part generators are in `src/templates/`.

### Command line

The commands run from `src/cli.ts`:

```sh
bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]
bun run scaffold new <absent-target-directory> --name <app-name> [--display-name <label>] [--collection <type>] [--published | --registry <url>]
bun run scaffold add collection <type> [--app <directory>]
bun run scaffold add capability <operation-id> --kind command|query --description <text> [--app <directory>]
bun run scaffold add target <name> --collection <type> [--app <directory>]
bun run scaffold add agent <name> --collection <type> [--app <directory>]
bun run scaffold versions [<application-directory>]
```

- **Export** with `--example <name>` exports one [example](../../docs/glossary.md#example) as the hosted application, with the examples it imports. A field application keeps the hub application whose modules it shares. The export leaves the other examples, their reference sets, root dependencies and lockfile entries out.
- **`new`** exports no example and generates one application in `examples/<name>`.
- **`add`** extends that application with a collection, a [capability](../../docs/glossary.md#capability), a [target](../../docs/glossary.md#target) or an agent.
- **`versions`** checks that an installed application has one framework version.

### Published-framework export

With `--published` or `--registry <url>`, `new` leaves the framework source out and depends on the framework packages at the checkout's version. The export:

- leaves out `packages/*`, `plugins/*`, `sdks/*`, the lockfile and the release scripts;
- makes the root manifest depend on every framework package at the checkout's framework version;
- sets the `workspaces` field to `apps/*` and `examples/*`;
- drops root scripts that test or release framework source, and removes them from chains such as `check`;
- points the starter's relative references to framework files (tsconfig paths, stylesheets, README links) into `node_modules`.

`--registry` writes a `bunfig.toml` that installs the `@agent-native` scope from that URL. The first `bun install` writes the lockfile; commit it. Only `new` supports a published-framework export, because the examples' own tests read plugin and SDK source by path.

### Generated parts

`add agent` writes an agent definition that reads the collection and proposes `<type>.update`. Its agent scenarios are played by the deterministic harness. The first agent also adds:

- the proposal capabilities, with their handlers, rules and state;
- a Proposals screen where a person accepts or rejects.

`add target` also lists the target's destination as disabled in `apps/desktop/site-policy.json`. `site check` then passes until someone binds the destination to the system of record's URL.

`add` works on the hosted application unless `--app` names another directory. It starts no processes; run `bun run format && bun run generate` afterwards.

The application skeleton is a set of `.tpl` files in `templates/application`, rendered with `{{name}}` placeholders. A placeholder without a value throws. The skeleton is text rather than code, so the boundary check does not read its plugin imports as the scaffold's own. Functions in `src/templates/` generate the parts, because parts differ by kind: a command or a query, a target's collection.

A generated application keeps `// scaffold:<list>` comments in its capabilities, handlers, policy rules, lanes, state, options, integrations, routes and navigation. `add` inserts on the lines before the marker, so the marker stays last. `add` refuses:

- an application without its manifest and policy;
- a part whose file already exists;
- a file without the marker it needs.

It writes nothing unless every file is produced.

## Trust boundary

The scaffold copies source only. It refuses to overwrite an existing target and refuses a target inside the source checkout. It skips:

- workspace data, build output, and connection and session files;
- `.env*` files;
- anything named like a secret, credential, token or private key.

No credentials or workspace data leave the checkout. Source files are text and are rewritten for the new name. PNG and JPEG images, such as test fixtures and golden screenshots, are copied byte for byte. The application name must be a lowercase npm-style name. The display name must be single-line text without `*/`.

Files are staged and moved into place only when the export completes. `add` edits only files of the application it was pointed at.

A generated application lists the site, network, audit and compliance plugins. It gives each target an [integration principal](../../docs/glossary.md#integration-principal) with its own lane and no role. Commands are for editors and reads for members; adjust `policy.ts` before adding people.

`versions` reads package manifests under `node_modules` only. A published-framework export trusts the configured registry for the `@agent-native` scope as it trusts npm for other packages. The lockfile then pins each tarball's integrity.

Gap: an example export always copies the framework.

## Dependencies

Framework: `@agent-native/contracts` (canonical JSON for the manifest). Node: filesystem and `node:crypto`.

## Tests

```sh
bun run test:scaffold
bun run test:scaffold:full   # the export flows, and a new application installed from a loopback registry
```

- `src/scaffold.test.ts`:
  - deterministic export, with private and runtime artifacts left out and images copied unchanged;
  - single-example selection with the examples it imports;
  - rejection of checkout-specific paths;
  - a certificate exported and a file holding a private key refused.
- `src/generate.test.ts`:
  - `new`: one generated package, its root dependency and lockfile entries, no example copied;
  - `add` of each kind at the markers, refusals and marker insertion;
  - lockfile ordering and template rendering.
- `src/versions.test.ts`: the mixed-version refusal.

The full acceptance runs are opt-in with `SCAFFOLD_ACCEPTANCE=1`, so an exported test cannot export itself recursively:

- The generated application's run adds a collection, a capability and a target. It then runs format, generate, typecheck, build, its tests and its Playwright spec of the default screens.
- The registry run packs the framework, serves it on loopback and exports with `--registry`. It installs, reinstalls with `--frozen-lockfile` from a clean `node_modules` and adds a target. It then runs the application's whole `check` and its Playwright spec.

## Skills

- [create-agent-native-app](skills/create-agent-native-app/SKILL.md): creating an application with the scaffold.
