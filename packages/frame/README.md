# @tortoise/frame

`@tortoise/frame` supplies the browser shell around an application's screens. `defineScreens` registers routes and screen contributions supplied by the application. The frame manages the authenticated browser session and routes reads and commands through the client.

The Vite entrypoint resolves `virtual:tortoise/screens` from `app.config.json` at build time. Framework frame code imports no application content. An application can override a frame file at the corresponding path under `apps/web/src`. Shared behavior belongs in this package so an exported starter can receive it through framework updates.

## References

[build-screens](skills/build-screens/SKILL.md)

[Interaction contract](../../docs/interaction-contract.md)

Test: `bun test packages/frame`, `bun run test:e2e`
