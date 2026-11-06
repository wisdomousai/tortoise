# @tortoise/testing

`@tortoise/testing` supplies conformance helpers for application behavior and framework ports. Behavioral scenarios run against the selected channel drivers using trusted context supplied by the test. Separate helpers check the screen bindings declared by an application.

Storage conformance exercises transaction behavior and persistence through an adapter. Agent scenarios assert command outcomes and approval requests on a configured harness. Those assertions establish the behavior exercised by the fixture; provider execution and device operation require their own evidence.

## References

[check-a-change](skills/check-a-change/SKILL.md)

[Development and testing](../../docs/development-and-testing.md)

Test: `bun test packages/testing`, `bun run test:conformance`
