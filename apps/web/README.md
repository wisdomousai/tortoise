# @tortoise/web

The web root: the web frame around the configured application's screens, plus shadcn primitives and styles. It never names application content; Vite resolves `virtual:tortoise/screens` from `app.config.json`. The local instance serves the build from a flat directory under a strict Content Security Policy with no inline scripts or styles, and Electron loads the same files unchanged.

- Primitives: [Starter](../../docs/primitives.md#starter), [Web frame](../../docs/primitives.md#web-frame), [UI registry](../../docs/primitives.md#ui-registry).

## References

- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)
- [Desktop](../../docs/desktop.md)
- Test: `bun run check:boundaries`, `bun run test:e2e`
