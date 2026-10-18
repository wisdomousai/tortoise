# @agent-native/operator-ui

Input parts for an [operator](../../docs/glossary.md#operator) at a point of work, published as the `operator` [UI registry](../../docs/glossary.md#ui-registry) over stock shadcn primitives. The parts use glove-sized targets and hold-to-confirm for consequential actions, and they show state as an icon plus text instead of color alone. An application pulls an item with `shadcn add` and owns the copied source.

## Layer

Framework (`packages/*`). Browser code. Trust-relevant behavior stays in the catalog [commands](../../docs/glossary.md#command) the parts call, which authorize and validate.

## Primitives

- [UI registry](../../docs/primitives.md#ui-registry):
  - the theme `operator-theme` and the library `numeric-entry`;
  - the components `operator-surface`, `operator-station`, `big-action`, `numeric-pad`, `tile-picker`, `scan-prompt`, `scanner-setup`, `status-strip`, `attention-queue` (with `approvalChoices`) and `takeover-button`;
  - the hooks `use-press-and-hold`, `use-tap-guard`, `use-operator-keys`, `use-scanner`, `use-feedback` and `use-idle-return`.
- [Approval request](../../docs/primitives.md#approval-request): the attention queue's `approval request` kind and `approvalChoices` give an agent's [approval request](../../docs/glossary.md#approval-request) a one-tap Approve and a Reject. The station resolves them to `approval.approve` and `approval.reject`.

[Point-of-work input](../../docs/point-of-work-input.md) and [operator workstations](../../docs/operator-workstations.md) explain the interaction rules. [`examples/line-station/ui/station.tsx`](../../examples/line-station/ui/station.tsx) composes a station [screen](../../docs/glossary.md#screen) from these parts.

## Entrypoints

| Import                                   | Runs in    | Contents                                                                    |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `@agent-native/operator-ui/components/*` | browser    | One component from `src/components/`, such as `components/big-action`.      |
| `@agent-native/operator-ui/hooks/*`      | browser    | One hook from `src/hooks/`, such as `hooks/use-press-and-hold`.             |
| `@agent-native/operator-ui/package.json` | build time | The manifest, so the frame's Vite plugin can locate this package's sources. |

Inside this repository, screens import the parts through the `@/` alias, as in `@/components/big-action`. The frame's Vite plugin resolves the alias after the starter's and the frame's sources. The imports read exactly as they do after `shadcn add`.

[`registry.manifest.ts`](registry.manifest.ts) is the source of truth. `bun run build:registry:operator` generates `registry.json` and `src/styles/operator.css` from it and builds the registry into `dist/registry/operator`. Do not edit the two generated files by hand.

An item may ship several files that import each other. `scanner-setup` pulls three files that are not items of their own:

- `scanner-calibration`: the calibration code, the key recorder and step 1;
- `scanner-profile-form`: step 2;
- `scan-readout`: the live scan and GS1 readout.

The registry check accepts imports between files of the same item. Every other `@/` import must be a declared dependency.

## Trust boundary

Nothing here is a security boundary. Parts hold no state beyond what input needs. Every slot is data from queries, and every action is a callback that issues a catalog command. The behavior the parts guarantee concerns intent:

- `use-press-and-hold` replaces confirmation dialogs for consequential actions. Releasing early, sliding off or cancelling aborts, and auto-repeat is ignored.
- `use-tap-guard` drops double taps, bouncing pedals, scroll gestures and layout-shift activations.
- `use-operator-keys` holds printable keys briefly, so a keyboard-wedge burst fires no hotkey, including the scan's terminating Enter.
- `use-idle-return` sends a shared station home after inactivity, so the next operator does not act on someone else's context.
- `takeover-button` lets the operator preempt a background agent with one tap. Handing the screen back needs a hold.

No shadcn primitive is forked. Sizing comes from the density tokens `glove`, `touch` and `desk` and from `cva` variants.

## Dependencies

Framework: `@agent-native/devices`. External: `react`, `class-variance-authority`, `lucide-react` and `bwip-js` (calibration barcodes). Stock shadcn primitives come from the consumer's `@/components/ui`.

## Tests

```sh
bun test packages/operator-ui
bun run check:registry:operator
```

- `test/primitives.test.ts`: numeric entry and tolerance, the tap guard and key-burst filtering. It also checks that `registry.json` and the theme stylesheet match the manifest, with every import declared.
- `check:registry:operator` fails on registry drift.

Gap: no acceptance test runs `shadcn add` in a scratch application.

## Skills

- [build-screens](../frame/skills/build-screens/SKILL.md): screens, forms, live queries and registry items.
- [add-scanner-input](../devices/skills/add-scanner-input/SKILL.md): scanner sources, profiles and routes.
