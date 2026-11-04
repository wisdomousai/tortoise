# @tortoise/scaffold

Creates new applications, adds parts to them and exports the framework as a standalone application. `bun run scaffold new <dir> --name <name>` starts one; `bun run scaffold add` inserts a collection, capability, target, agent, assignment kind or feature at the `// scaffold:` markers. It copies source only, never overwrites an existing directory and refuses a target inside the source checkout.

- Primitives: [Scaffold](../../docs/primitives.md#scaffold), [Framework release](../../docs/primitives.md#framework-release), [Collection](../../docs/primitives.md#collection), [Policy](../../docs/primitives.md#policy), [Target](../../docs/primitives.md#target), [UI registry](../../docs/primitives.md#ui-registry).

## References

- [create-agent-native-app](skills/create-agent-native-app/SKILL.md)
- [Getting started](../../docs/getting-started.md)
- Test: `bun run test:scaffold`, `bun run test:scaffold:full`
