# @agent-native/operator-ui

Thick-finger operator input parts, distributed as the `operator` shadcn registry over stock shadcn primitives. They follow the point-of-work rules: glove-sized targets, hold-to-confirm for consequential actions, and state shown as icon plus text, never color alone. Applications pull items with `shadcn add` and own the copied source; trust-relevant behavior stays in the catalog commands the parts call.

Layer: framework (`packages/*`). Browser code.

## Primitives

- [UI registry](../../docs/primitives.md#ui-registry): `operator-theme`, `operator-surface`, `operator-station`, `big-action`, `numeric-pad`, `tile-picker`, `scan-prompt`, `scanner-setup`, `status-strip`, `attention-queue`, `takeover-button`, and the hooks `use-press-and-hold`, `use-tap-guard`, `use-operator-keys`, `use-scanner`, `use-feedback`, `use-idle-return`.

[Point-of-work input](../../docs/point-of-work-input.md) and the [operator workstation pattern](../../docs/operator-workstation-pattern.md) explain the interaction rules. [`examples/line-station/ui/station.tsx`](../../examples/line-station/ui/station.tsx) composes a station screen from these parts.

## Entrypoints

| Import                                   | Runs in    | Contents                                                                                             |
| ---------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `@agent-native/operator-ui/components/*` | browser    | One component from `src/components/`, for example `@agent-native/operator-ui/components/big-action`. |
| `@agent-native/operator-ui/hooks/*`      | browser    | One hook from `src/hooks/`, for example `@agent-native/operator-ui/hooks/use-press-and-hold`.        |
| `@agent-native/operator-ui/package.json` | build time | The manifest, so the frame's Vite plugin can locate this package's sources.                          |

Inside this repository, screens import the parts through the `@/` alias (`@/components/big-action`), which the frame's Vite plugin resolves after the starter's and the frame's sources, exactly as the imports read after `shadcn add`.

[`registry.manifest.ts`](registry.manifest.ts) is the source of truth. `bun run build:registry:operator` generates `registry.json` and `src/styles/operator.css` from it and builds the registry into `dist/registry/operator`. Do not edit the two generated files by hand.

An item may ship several files that import each other. `scanner-setup` is one: `scanner-calibration` (the calibration code, key recorder and step 1), `scanner-profile-form` (step 2) and `scan-readout` (live scan and GS1 readout) are pulled with it and are not items of their own. The registry check accepts imports between files of the same item and still requires every other `@/` import to be a declared dependency.

## Trust boundary

Nothing here is a security boundary. Parts hold no state beyond what input needs: every slot is data from queries and every action is a callback that issues a catalog command. The behavior they guarantee is about intent:

- `use-press-and-hold` replaces confirmation dialogs for consequential actions; releasing early, sliding off or cancelling aborts, and auto-repeat is ignored.
- `use-tap-guard` drops double taps, bouncing pedals, scroll gestures and layout-shift activations.
- `use-operator-keys` holds printable keys briefly so a keyboard-wedge burst never fires a hotkey, including the scan's terminating Enter.
- `use-idle-return` sends a shared station home after inactivity, so the next operator never acts on someone else's context.
- `takeover-button` lets the operator preempt a background agent with one tap; handing the screen back needs a hold.

No shadcn primitive is forked: sizing comes from density tokens (`glove`, `touch`, `desk`) and `cva` variants.

## Dependencies

Framework: `@agent-native/devices`. External: `react`, `class-variance-authority`, `lucide-react`, `bwip-js` (calibration barcodes). Stock shadcn primitives come from the consumer's `@/components/ui`.

## Tests

```sh
bun test packages/operator-ui
bun run check:registry:operator
```

`test/primitives.test.ts` covers numeric entry and tolerance, the tap guard, key-burst filtering, and that `registry.json` and the theme stylesheet match the manifest with every import declared. `check:registry:operator` fails on registry drift ([P8](../../docs/principles.md#p8--specialization-is-composition-and-configuration-never-a-fork)). Gap: no scratch-app `shadcn add` acceptance test.
