# 005 — Framework, shell and content are separate layers

Accepted: the repository has three layers, and each running authority hosts exactly one application (P11).

- **Framework** (`packages/*`): domain-neutral primitives, ports and adapters. It imports neither the shell nor content.
- **Shell** (`apps/*`): the domain-neutral host that runs one application. It owns workspace ownership, sessions and launch, the HTTP/SSE, MCP and CLI entrypoints, run supervision, the web frame and the desktop wrapper. It receives an application definition and never imports `examples/*`.
- **Content** (`examples/*`): applications. Each one is a composition root that declares its modules, state, policy routes, handlers, services and connectors (including demo fakes), integration principals, screens and navigation. It may compose several modules, such as line-station with device configuration.

Dependencies point one way: content → shell → framework. The application definition is a framework type, so the shell runs any value of it without naming one, and an application starts by handing its definition to the shell's public entrypoint.

The catalog, generated artifacts, workspace and launch belong to one application. Running another example means starting the shell with another application, not loading every example into one process. The scaffold exports framework, shell and one application.

This keeps the shell reusable without edits when an application is added, makes each example a standalone reference that a scaffold can export on its own, and stops one domain's services, fakes and screens from appearing in another's catalog. Composition of independently authored modules stays proven inside one application and by `packages/runtime/test/compose.test.ts`.

At the time of this decision the shell still composes all three examples (`apps/service/src/composition.ts`, `modules.ts`, `host.ts`, `demo.ts`, `apps/web/src/app.tsx`). Milestone M10 in the implementation plan migrates it. The migration ends when `bun run check:boundaries` rejects imports from `apps/*` into `examples/*`.
