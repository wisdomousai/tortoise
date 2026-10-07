# 001 — Explicit capability composition

Accepted: pure contracts and explicit IoC composition supply every surface. Executable handlers, React components and test scenarios remain separate contributions. Generation must not open storage, load provider credentials or start a server.

This avoids global registration order, duplicate action inventories and browser imports of privileged runtime code. Contract validation fails before service startup for duplicate IDs, missing dependencies, cycles, unknown workflow references and missing UI declarations. Surface-specific omissions require a documented exception.
