# @agent-native/web

The starter's web root: the [web frame](../../packages/frame/README.md) around the configured [application](../../docs/glossary.md#application)'s [screens](../../docs/glossary.md#screen), the stock shadcn primitives and the starter's styles. The Vite config asks the frame for its plugins, which bind the application's `screens` entrypoint to `virtual:agent-native/screens`. This package therefore never names content.

## Layer

[starter](../../docs/glossary.md#starter) (`apps/*`). Extend it here, or shadow any frame file by adding one at the same `src/` path.

## Primitives

- [Starter](../../docs/primitives.md#starter): the web half of the starter.
- [Web frame](../../docs/primitives.md#web-frame) and [UI registry](../../docs/primitives.md#ui-registry): the frame and registry the starter builds on.

## Entrypoints

This package exports nothing; it is built.

| File | Runs in | Holds |
| --- | --- | --- |
| [`vite.config.ts`](vite.config.ts) | build time | Frame wiring, the browser-boundary plugin, React and Tailwind, with flat output in `dist/web/<application id>`. |
| [`src/main.tsx`](src/main.tsx) | browser | Exchanges the launch credential, then renders `App`. |
| [`src/app.tsx`](src/app.tsx) | browser | `App`: `<Frame screens={screens} />`. |
| [`src/styles.css`](src/styles.css) | browser | Tailwind entry and theme tokens. |
| `src/components/ui/*` | browser | Stock shadcn primitives, unmodified; add more with `shadcn add` (see [`components.json`](components.json)). |

`@/` resolves against this `src` first, then the frame, then the operator registry. A file here at the same path as a frame file replaces it.

```sh
bun run build               # the configured application
bun run build:web:examples  # every example
```

## Trust boundary

The local [instance](../../docs/glossary.md#instance) serves the web build from a flat directory under a strict Content Security Policy (CSP), with no inline scripts or styles. Electron loads the same files unchanged. Output names are flat and routing uses hash history for that reason. The [session](../../docs/glossary.md#session) is an HttpOnly cookie obtained from the one-time launch credential through the [launch exchange](../../docs/glossary.md#launch-exchange). Script state holds no session credential.

Browser code must not import host-only modules or Node built-ins. The browser-boundary plugin fails the build when it does.

## Dependencies

Framework: `@agent-native/frame`. External: `react`, `react-dom`, `radix-ui`, `cmdk`, `class-variance-authority`, `cn`, `lucide-react`, `@fontsource-variable/ibm-plex-sans` and `@fontsource/ibm-plex-mono`. At build time: `vite`, `@vitejs/plugin-react` and `@tailwindcss/vite`. The package must never import `showcase/examples/*`.

## Tests

```sh
bun run check:boundaries
bun run build
bun run test:e2e
```

The package has no test files of its own. `check:boundaries` bundles every example's screens through this Vite config. The Playwright specs in `showcase/examples/*/e2e` and `showcase/patterns/*/e2e` drive the built web root in Chromium.

## Skills

- [build-screens](../../packages/frame/skills/build-screens/SKILL.md): screens, registry components and replacing a frame file in the starter.
