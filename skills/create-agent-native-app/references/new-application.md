# New application

Locate the source checkout by its root `package.json` and `packages/scaffold/src/index.ts`; do not assume a machine-specific path. From that checkout run:

```sh
bun run scaffold /absolute/path/to/absent-target --name my-application --display-name "My Application"
```

The command copies allowlisted source packages, app entrypoints, tests, scripts, documentation, the lockfile and skills. Framework packages remain local workspaces. It excludes dependency directories, build output, workspace data, credentials and symlinks, and refuses any existing target. `scaffold.manifest.json` records the framework version and SHA-256 of exported files. The export does not initialize Git or install dependencies. `app.config.json` owns the application name, display name and desktop app ID; the export sets these from the supplied name. Browser builds and desktop packaging consume that identity. Set a production app ID before distributing the application.

In the new checkout install the pinned dependencies with `bun install --frozen-lockfile`, then run `bun run typecheck`, `bun run generate`, `bun test`, and `bun run build`. Run the documented browser/desktop checks when those products are part of the request. A cold dependency cache needs network access; an offline install failure is a dependency-fetch limitation, not an application check passing.

Use the project/task example to establish the working end-to-end baseline, then author the requested domain. Change domain contracts/handlers/policy/UI/workflows together. Keep the generic framework packages free of domain-specific imports. Do not present the example as the finished requested application.
