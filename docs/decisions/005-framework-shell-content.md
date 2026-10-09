# 005 — Framework, starter and content are separate layers

Accepted. Plugins were added as a further layer by [ADR 010](010-host-plugins.md). Serves [P11](../principles.md#p11--layers-depend-inward-and-an-authority-runs-one-application).

**Context.** The repository is both a framework and a set of example applications. If the runnable shell knows its examples, every new application edits the shell, and a team that forks the shell to build its own application stops receiving framework changes.

**Decision.**

- **Framework** (`packages/*`): domain-neutral primitives, ports and adapters, including the generic host and the web frame. It imports neither the starter nor content.
- **Starter** (`apps/*`): thin wiring that its owner forks or generates and then owns. It learns which application to run from configuration (inversion of control), and the owner may override any frame file.
- **Content** (`examples/*`, or the owner's modules): applications that implement framework contracts through three entrypoints, a browser-safe manifest, a server definition and screens.
- **One application per authority.** The catalog, generated artifacts, web build, workspace and launch belong to one application. Running another application means starting the starter with different configuration, never loading several into one process.
- **Distribution.** One upstream monorepo. A scaffold command exports the starter, the framework and one example as a standalone project. Keep the starter thin and the framework fat, so upgrades land in packages rather than in forked code.

**Consequences.**

- Adding an application never edits the framework or the starter.
- Tests that use an example as a fixture live in that example, so framework suites never depend on content.
- Compiled builds cannot follow a runtime import, so they generate a static entry for the configured application.
- Framework packages are unpublished, so an export vendors them. Publishing them needs a release process first.

**Alternatives considered.** A shell that registers every example: simpler to run, but every application edits shared code, and examples leak into each other's catalogs.
