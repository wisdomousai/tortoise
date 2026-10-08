# @agent-native/scaffold

Exports the framework, the starter and content as a standalone application in a new directory. The export carries a versioned file-hash manifest, installs with the pinned lockfile and passes its own checks. With `--example <name>` it exports one example as the hosted application and leaves the other examples, their reference sets, root dependencies and lockfile entries out.

Layer: framework (`packages/*`). Server-side CLI.

## Primitives

- [Scaffold](../../docs/primitives.md#scaffold): `scaffold`, `ScaffoldOptions`, `ScaffoldManifest`.

The root [README](../../README.md#create-another-app) shows the full flow, and the [setup skill](../../skills/create-agent-native-app/SKILL.md) guides an agent through replacing the example domain afterwards.

## Entrypoints

| Import                     | Runs in     | Contents                                                                                                    |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `@agent-native/scaffold`   | server only | `scaffold(options)`, `ScaffoldOptions`, `ScaffoldManifest`.                                                 |
| `@agent-native/scaffold/*` | server only | One source file: `scaffold`, `file-rules` (what is exported), `examples` (single-example pruning) or `cli`. |

From the command line (`src/cli.ts`):

```sh
bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]
```

## Trust boundary

The scaffold copies source only. It refuses to overwrite an existing target and refuses a target inside the source checkout. It skips workspace data, build output, connection and session files, `.env*` files and anything named like a secret, credential, token or private key, so no credentials or workspace data leave the checkout. The application name must be a lowercase npm-style name, and the display name single-line text. Files are staged and moved into place only when the export completes.

Gap: framework packages are unpublished, so an export vendors `packages/*` instead of depending on published versions.

## Dependencies

Framework: `@agent-native/contracts` (canonical JSON for the manifest). Node: filesystem and `node:crypto`.

## Tests

```sh
bun run test:scaffold
bun run test:scaffold:full   # fresh export, frozen install, typecheck, build, tests and an added capability
```

`src/scaffold.test.ts` covers deterministic export, private and runtime artifacts left out, single-example selection and rejection of checkout-specific paths ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)). The full acceptance run is opt-in (`SCAFFOLD_ACCEPTANCE=1`) so an exported test cannot export itself recursively.
