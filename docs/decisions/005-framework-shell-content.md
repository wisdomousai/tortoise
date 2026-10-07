# 005 — Framework, starter and content are separate layers

Accepted: the repository has three layers. A running authority hosts exactly one application, which the starter resolves from configuration (P11).

- **Framework** (`packages/*`): domain-neutral primitives, ports and adapters. It includes the generic host (`@agent-native/host`: workspace ownership, sessions and launch, HTTP/SSE, embedded MCP, the CLI, run supervision and provider access) and the web frame (`@agent-native/frame`: session bindings, routing, palette, run panel and accounts, shipped as a shadcn registry). The framework imports neither the starter nor content.
- **Starter** (`apps/*`): a thin boilerplate that you fork or generate and then own. It holds wiring and configuration: `app.config.json` (identity and the hosted application), the service and CLI entrypoints, the web root, stock shadcn primitives, styles and the desktop wrapper. Extend it as far as you like. Any frame file can be shadowed by a starter file at the same `src/` path, or taken over with `shadcn add`.
- **Content** (`examples/*`, or your own modules): applications that implement framework contracts. Each one has three entrypoints:
  - `manifest` (browser-safe): id, title and capability modules;
  - `application` (server): an `ApplicationDefinition` with state, upgrade, policy routes, handlers, selectable resources and `connect` for systems of record, observers and demo fakes;
  - `screens` (browser): routes, navigation, the screen each capability family opens, and a status slot.

  One application may compose several modules, such as line-station with device configuration.

**Dependencies.** Content depends on framework contracts. The starter depends on the framework and learns its content only through configuration. This is inversion of control: `app.config.json` names a package or a relative directory (or `AGENT_NATIVE_APPLICATION` does, in development). The host loads `<application>/application` at runtime and the frame's Vite plugin binds `<application>/screens`. Compiled builds cannot follow a runtime import, so they generate a static entry for the same application. `bun run check:boundaries` rejects framework → starter/content, starter → content and content → starter imports.

**Ownership.** The catalog, generated artifacts (`docs/reference/<id>/`), web build (`dist/web/<id>/`), workspace and launch belong to one application. Running another example means starting the starter with another application, never loading every example into one process. Tests that use an example as a fixture live in that example, so the framework's own suites never depend on content.

**Distribution.** There is one upstream repository, developed as a monorepo. `bun run scaffold <target> --name <app> [--example <name>]` exports the starter, the framework and one example (or all of them), configured as the hosted application, with the example's own scripts, tests and end-to-end specs. Framework packages are private and unpublished, so an export vendors them as workspace packages. Replacing `workspace:*` with published versions is the remaining step and needs a release process first. This follows what comparable projects do: Medusa (modules resolved from config), Payload (templates inside the monorepo, a `create-*-app --example` generator) and Backstage (a create-app template that its owner upgrades). The lesson they share is to keep the starter thin and the framework fat, so upgrades land in packages rather than in forked code.

This keeps the starter reusable without edits when an application is added. Each example becomes a standalone reference that the generator can export on its own, and one domain's services, fakes and screens cannot appear in another's catalog. Composition of independently authored modules stays proven inside one application and by `packages/runtime/test/compose.test.ts`.
