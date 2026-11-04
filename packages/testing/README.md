# @tortoise/testing

Test helpers: behavioral scenarios that run the same on every channel, UI-binding checks, connector and storage conformance suites, and agent scenarios judged by command results and approval requests. Scenarios take the `ExecutionContext` from the test, which stands in for the trusted host.

- Primitives: [Behavioral scenario](../../docs/primitives.md#behavioral-scenario), [Model entry](../../docs/primitives.md#model-entry), [Storage](../../docs/primitives.md#storage), [Feature](../../docs/primitives.md#feature), [Agent scenario](../../docs/primitives.md#agent-scenario).

## References

- [check-a-change](skills/check-a-change/SKILL.md)
- [Development and testing](../../docs/development-and-testing.md)
- Test: `bun test packages/testing`, `bun run test:conformance`
