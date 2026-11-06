# @tortoise/operator-ui

`@tortoise/operator-ui` supplies workstation components through the `operator` shadcn registry. The components present device configuration and scanner controls. Their interaction targets and confirmation behavior support use at a physical workstation.

Installing a registry component creates a copy owned by the application. The component still invokes catalog operations under the current session, and the runtime remains responsible for authorization. `check:registry:operator` checks that the published registry content matches its source.

## References

[build-screens](../frame/skills/build-screens/SKILL.md), [add-scanner-input](../devices/skills/add-scanner-input/SKILL.md)

[Operator input](../../docs/operator-input.md)

Test: `bun test packages/operator-ui`, `bun run check:registry:operator`
