# @tortoise/frame

The web frame: the browser shell around an application's screens, with sign-in, routing, navigation, the command palette, the agent run panel and accounts. It imports no application, feature or plugin. `defineScreens({ features, plugins })` passes their screens in, and the Vite plugin resolves `virtual:tortoise/screens` from `app.config.json` at build time.

- Primitives: [Web frame](../../docs/primitives.md#web-frame), [Application](../../docs/primitives.md#application), [UI registry](../../docs/primitives.md#ui-registry), [Approval request](../../docs/primitives.md#approval-request), [UI session context](../../docs/primitives.md#ui-session-context), [Display metadata](../../docs/primitives.md#display-metadata), [Reconciliation](../../docs/primitives.md#reconciliation), [OS handler](../../docs/primitives.md#os-handler), [OS action](../../docs/primitives.md#os-action), [Generator](../../docs/primitives.md#generator), [Feature](../../docs/primitives.md#feature), [Host plugin](../../docs/primitives.md#host-plugin), [Shelf life](../../docs/primitives.md#shelf-life).

## References

- [build-screens](skills/build-screens/SKILL.md)
- [Interaction contract](../../docs/interaction-contract.md)
- Test: `bun test packages/frame`, `bun run test:e2e`
