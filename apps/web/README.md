# @agent-native/web

The starter's web root: the [frame](../../packages/frame/README.md) around the configured application's screens, the stock shadcn primitives and the starter's styles. The Vite config asks the frame for its plugins, which bind the application's `screens` entrypoint to `virtual:agent-native/screens`, so this workspace never names content.

Layer: starter (`apps/*`). Owned by whoever forks or scaffolds the starter: extend it here, or shadow any frame file by adding one at the same `src/` path.

## Primitives

- [Starter](../../docs/primitives.md#starter): the web half of the starter.
- The frame and its registry are documented under [Web frame](../../docs/primitives.md#web-frame) and [UI registry](../../docs/primitives.md#ui-registry).

## Entrypoints

This workspace exports nothing; it is built.

| File                               | Purpose                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`vite.config.ts`](vite.config.ts) | Frame wiring, the browser-boundary plugin, React and Tailwind. Output: flat files in `dist/web/<application id>`. |
| [`src/main.tsx`](src/main.tsx)     | Exchanges the launch credential, then renders `App`.                                                              |
| [`src/app.tsx`](src/app.tsx)       | `App`: `<Frame screens={screens} />`.                                                                             |
| [`src/styles.css`](src/styles.css) | Tailwind entry and theme tokens.                                                                                  |
| `src/components/ui/*`              | Stock shadcn primitives, unmodified. Add more with `shadcn add`; see [`components.json`](components.json).        |

`@/` resolves against this `src` first, then the frame, then the operator registry. A file here at the same path as a frame file replaces it.

Build with `bun run build` (configured application) or `bun run build:web:examples` (every example).

## Trust boundary

The page is served by the local authority from a flat directory under a strict CSP (no inline scripts or styles) and loaded unchanged by Electron, which is why output names are flat and routing uses hash history. The session is an HttpOnly cookie obtained from the one-time launch credential; no token is held in page state. Browser code must not import host-only modules or Node built-ins: the browser-boundary plugin fails the build if it does.

## Dependencies

Framework: `@agent-native/frame`. External: `react`, `react-dom`, `radix-ui`, `cmdk`, `class-variance-authority`, `cn`, `lucide-react`, and at build time `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`. It must never import `examples/*` ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application)).

## Tests

```sh
bun run check:boundaries
bun run build
bun run test:e2e
```

`check:boundaries` bundles every example's screens through this Vite config. The Playwright specs in `examples/*/e2e` drive the built page in Chromium.
