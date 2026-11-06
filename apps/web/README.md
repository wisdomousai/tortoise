# @tortoise/web

`@tortoise/web` is the starter's web entrypoint and override directory. Vite resolves the configured application's screens through `virtual:tortoise/screens`. Frame behavior is supplied by `@tortoise/frame`.

The instance serves the resulting files under its Content Security Policy. Electron loads the same web build. Add an application-specific override at the corresponding path under `src/`; shared frame changes belong in the frame package.

## References

[build-screens](../../packages/frame/skills/build-screens/SKILL.md)

[Desktop](../../docs/desktop.md)

Test: `bun run check:boundaries`, `bun run test:e2e`
