/**
 * Source of truth for the operator registry. `scripts/build-operator-registry.ts` turns it into
 * `registry.json` (consumed by `shadcn build`) and `src/styles/operator.css` (imported directly by
 * apps in this repository). Keeping both generated means a consumer who pulls `operator-theme`
 * gets exactly the tokens this repository's own screens use.
 */

/** Sizes per density. Glove: ≥ 15 mm targets on a typical 15" industrial panel. */
const densities = {
  glove: {
    target: '5rem',
    targetLg: '6.5rem',
    gap: '1rem',
    text: '1.5rem',
    textLg: '2rem',
    textXl: '3.5rem',
  },
  touch: {
    target: '4rem',
    targetLg: '5.25rem',
    gap: '0.75rem',
    text: '1.25rem',
    textLg: '1.625rem',
    textXl: '2.75rem',
  },
  desk: {
    target: '2.75rem',
    targetLg: '3.5rem',
    gap: '0.5rem',
    text: '1rem',
    textLg: '1.25rem',
    textXl: '2rem',
  },
} as const;
const vars = (density: (typeof densities)[keyof typeof densities]) => ({
  '--operator-target': density.target,
  '--operator-target-lg': density.targetLg,
  '--operator-gap': density.gap,
  '--operator-text': density.text,
  '--operator-text-lg': density.textLg,
  '--operator-text-xl': density.textXl,
});

/**
 * Sizes are plain CSS variables (`--operator-target`, `--operator-gap`, `--operator-text…`) used
 * as `h-(--operator-target)` or `text-(length:--operator-text)`. Theme tokens such as `h-target`
 * would read better, but class mergers (`cn`, tailwind-merge) do not know custom token names:
 * `text-operator` would be taken for a color and drop the button's foreground color. Variable
 * forms merge correctly in every consumer without configuration.
 *
 * Semantic station signals. They are never conveyed by color alone: every component pairs them
 * with an icon and a word. Contrast is chosen for bright shop-floor light and for dark panels.
 */
export const operatorTheme = {
  cssVars: {
    theme: {
      'color-op-ok': 'var(--op-ok)',
      'color-op-ok-foreground': 'var(--op-ok-foreground)',
      'color-op-pending': 'var(--op-pending)',
      'color-op-pending-foreground': 'var(--op-pending-foreground)',
      'color-op-attention': 'var(--op-attention)',
      'color-op-attention-foreground': 'var(--op-attention-foreground)',
      'color-op-fault': 'var(--op-fault)',
      'color-op-fault-foreground': 'var(--op-fault-foreground)',
      'color-op-idle': 'var(--op-idle)',
      'color-op-idle-foreground': 'var(--op-idle-foreground)',
    },
    light: {
      ...Object.fromEntries(Object.entries(vars(densities.touch)).map(([k, v]) => [k.slice(2), v])),
      'op-ok': 'oklch(0.52 0.15 152)',
      'op-ok-foreground': 'oklch(0.99 0 0)',
      'op-pending': 'oklch(0.55 0.13 250)',
      'op-pending-foreground': 'oklch(0.99 0 0)',
      'op-attention': 'oklch(0.78 0.16 80)',
      'op-attention-foreground': 'oklch(0.2 0.03 70)',
      'op-fault': 'oklch(0.55 0.22 27)',
      'op-fault-foreground': 'oklch(0.99 0 0)',
      'op-idle': 'oklch(0.9 0.005 260)',
      'op-idle-foreground': 'oklch(0.3 0.01 260)',
    },
    dark: {
      'op-ok': 'oklch(0.72 0.16 152)',
      'op-ok-foreground': 'oklch(0.18 0.03 152)',
      'op-pending': 'oklch(0.72 0.12 250)',
      'op-pending-foreground': 'oklch(0.18 0.03 250)',
      'op-attention': 'oklch(0.84 0.15 82)',
      'op-attention-foreground': 'oklch(0.2 0.03 70)',
      'op-fault': 'oklch(0.7 0.19 25)',
      'op-fault-foreground': 'oklch(0.16 0.03 25)',
      'op-idle': 'oklch(0.3 0.01 260)',
      'op-idle-foreground': 'oklch(0.9 0.005 260)',
    },
  },
  css: {
    '@layer base': {
      '[data-density=glove]': vars(densities.glove),
      '[data-density=touch]': vars(densities.touch),
      '[data-density=desk]': vars(densities.desk),
      // High contrast: solid borders and stronger muted text for glare and older panels.
      '[data-contrast=high]': {
        '--border': 'var(--foreground)',
        '--input': 'var(--foreground)',
        '--muted-foreground': 'var(--foreground)',
      },
    },
    // No double-tap zoom, no text selection on long press, no grey tap flash.
    '@utility touch-operator': {
      'touch-action': 'manipulation',
      'user-select': 'none',
      '-webkit-user-select': 'none',
      '-webkit-tap-highlight-color': 'transparent',
    },
  },
} as const;

type ItemType =
  'registry:lib' | 'registry:hook' | 'registry:component' | 'registry:block' | 'registry:theme';
export interface ManifestItem {
  readonly name: string;
  readonly type: ItemType;
  readonly title: string;
  readonly description: string;
  readonly dependencies?: readonly string[];
  /** Stock shadcn names, or `operator:<name>` (emitted as `@operator/<name>`) for items of this registry. */
  readonly registryDependencies?: readonly string[];
  readonly files?: readonly string[];
}

export const registryName = 'operator';
export const items: readonly ManifestItem[] = [
  {
    name: 'operator-theme',
    type: 'registry:theme',
    title: 'Operator theme',
    description:
      'Density tokens (glove, touch, desk), high-contrast mode and icon-paired station signal colors used by every operator component.',
  },
  {
    name: 'numeric-entry',
    type: 'registry:lib',
    title: 'Numeric entry rules',
    description:
      'Pure keypad entry, parsing and tolerance helpers shared by the numeric pad and custom inputs.',
    files: ['src/lib/numeric-entry.ts'],
  },
  {
    name: 'use-press-and-hold',
    type: 'registry:hook',
    title: 'usePressAndHold',
    description: 'Hold-to-confirm for consequential actions; pointer, keyboard and foot pedal.',
    files: ['src/hooks/use-press-and-hold.ts'],
  },
  {
    name: 'use-tap-guard',
    type: 'registry:hook',
    title: 'useTapGuard',
    description: 'Rejects double taps, scrolls ending on a button and layout-shifted targets.',
    files: ['src/hooks/use-tap-guard.ts'],
  },
  {
    name: 'use-feedback',
    type: 'registry:hook',
    title: 'useFeedback',
    description: 'Distinct sounds and vibration for scan, accepted, rejected and attention.',
    files: ['src/hooks/use-feedback.ts'],
  },
  {
    name: 'use-idle-return',
    type: 'registry:hook',
    title: 'useIdleReturn',
    description: 'Returns a shared station to its home state after inactivity.',
    files: ['src/hooks/use-idle-return.ts'],
  },
  {
    name: 'use-operator-keys',
    type: 'registry:hook',
    title: 'useOperatorKeys',
    description: 'Binds digit keys, function keys and foot pedals to station actions.',
    files: ['src/hooks/use-operator-keys.ts'],
  },
  {
    name: 'use-scanner',
    type: 'registry:hook',
    title: 'useScanner',
    description:
      'Keyboard-wedge, serial, HID POS and camera scanning with profile decoding and deterministic scan routes.',
    dependencies: ['@agent-native/devices'],
    files: ['src/hooks/use-scanner.ts'],
  },
  {
    name: 'operator-surface',
    type: 'registry:component',
    title: 'Operator surface',
    description: 'Full-screen station frame that sets density and contrast for its subtree.',
    registryDependencies: ['utils', 'operator:operator-theme'],
    files: ['src/components/operator-surface.tsx'],
  },
  {
    name: 'big-action',
    type: 'registry:component',
    title: 'Big action',
    description:
      'The one primary action of a station screen; optional hold-to-confirm with visible progress.',
    dependencies: ['class-variance-authority', 'lucide-react'],
    registryDependencies: [
      'button',
      'kbd',
      'utils',
      'operator:operator-theme',
      'operator:use-press-and-hold',
      'operator:use-tap-guard',
    ],
    files: ['src/components/big-action.tsx'],
  },
  {
    name: 'tile-picker',
    type: 'registry:component',
    title: 'Tile picker',
    description: 'Large reason or code tiles, nine per page with digit hotkeys and big paging.',
    dependencies: ['lucide-react'],
    registryDependencies: [
      'button',
      'kbd',
      'utils',
      'operator:operator-theme',
      'operator:use-operator-keys',
      'operator:use-tap-guard',
    ],
    files: ['src/components/tile-picker.tsx'],
  },
  {
    name: 'numeric-pad',
    type: 'registry:component',
    title: 'Numeric pad',
    description:
      'On-screen keypad with unit, decimals, comma or period, and a live tolerance gauge.',
    dependencies: ['lucide-react'],
    registryDependencies: [
      'button',
      'utils',
      'operator:operator-theme',
      'operator:numeric-entry',
      'operator:use-operator-keys',
    ],
    files: ['src/components/numeric-pad.tsx'],
  },
  {
    name: 'scan-prompt',
    type: 'registry:component',
    title: 'Scan prompt',
    description: 'Scan-first prompt with a manual-entry fallback and the last scan result.',
    dependencies: ['lucide-react'],
    registryDependencies: ['button', 'input-group', 'utils', 'operator:operator-theme'],
    files: ['src/components/scan-prompt.tsx'],
  },
  {
    name: 'status-strip',
    type: 'registry:component',
    title: 'Status strip',
    description:
      'Icon-and-word station signals, a large signal banner for machine state, delivery badges for outbox states and freshness of observed values.',
    dependencies: ['lucide-react'],
    registryDependencies: ['badge', 'utils', 'operator:operator-theme'],
    files: ['src/components/status-strip.tsx'],
  },
  {
    name: 'attention-queue',
    type: 'registry:component',
    title: 'Attention queue',
    description:
      'Uncertain readings, agent questions and reconciliations, each resolved with large choices.',
    registryDependencies: [
      'card',
      'badge',
      'utils',
      'operator:operator-theme',
      'operator:big-action',
    ],
    files: ['src/components/attention-queue.tsx'],
  },
  {
    name: 'takeover-button',
    type: 'registry:component',
    title: 'Takeover button',
    description:
      'Seat control for screens shared by an operator and a background agent; taking over is instant, handing back needs a hold.',
    dependencies: ['lucide-react'],
    registryDependencies: ['utils', 'operator:operator-theme', 'operator:big-action'],
    files: ['src/components/takeover-button.tsx'],
  },
  {
    name: 'scanner-setup',
    type: 'registry:block',
    title: 'Scanner setup',
    description:
      'Calibrate any scanner by scanning one printed code, edit its profile, test scans with GS1 and route decoding, then save.',
    dependencies: ['@agent-native/devices', 'bwip-js', 'lucide-react'],
    registryDependencies: [
      'button',
      'card',
      'badge',
      'input',
      'label',
      'utils',
      'operator:operator-theme',
      'operator:big-action',
      'operator:status-strip',
      'operator:use-scanner',
    ],
    files: [
      'src/components/scanner-setup.tsx',
      'src/components/scanner-calibration.tsx',
      'src/components/scanner-profile-form.tsx',
      'src/components/scan-readout.tsx',
    ],
  },
  {
    name: 'operator-station',
    type: 'registry:block',
    title: 'Operator station',
    description:
      'Full-window station layout: dark header with back link, context, seat control and actions; machine banner; primary work area beside the attention queue; footer. Includes the station panel.',
    registryDependencies: [
      'utils',
      'operator:operator-surface',
      'operator:status-strip',
      'operator:attention-queue',
      'operator:takeover-button',
    ],
    files: ['src/components/operator-station.tsx'],
  },
];
