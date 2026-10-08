/**
 * Limits for `check:size` (P14). A file over `maxFileLines` or a function over `maxFunctionLines`
 * usually holds more than one responsibility; the limit is a tripwire, the split must still follow
 * responsibility. Functions are measured on their own node, so a factory counts the inner
 * functions it closes over: moving lines around inside a closure does not pass.
 */
export const maxFileLines = 300;
export const maxFunctionLines = 80;

/** Workspace sources that `check:size` measures. Tests, browser tests and generated output are exempt. */
export const measuredSource = /^(?:packages|apps|examples)\/.+\.[cm]?[jt]sx?$/;
export const exemptSource =
  /(?:\.test\.|\.pw\.ts$|\.d\.ts$|\/test\/|\/e2e\/|\/generated\/|\/dist\/|\/node_modules\/)/;

/** Package entrypoints that may only re-export (`export … from`); implementation lives beside them. */
export const barrel = /^packages\/[^/]+\/src\/index\.tsx?$/;

export interface SizeExemption {
  readonly path: string;
  /** Exempts one function by name; without it the entry exempts the file length. */
  readonly function?: string;
  /** Why the size is data, not logic. An entry that no longer exceeds a limit fails the check. */
  readonly reason: string;
}

/** Declarative tables only. Logic never goes here: split it instead. */
export const sizeExemptions: readonly SizeExemption[] = [
  {
    path: 'packages/assurance/src/controls.ts',
    reason: 'control catalog: one record per control, mapped to external frameworks',
  },
  {
    path: 'packages/operator-ui/registry.manifest.ts',
    reason: 'shadcn registry manifest: one entry per published item',
  },
  {
    path: 'examples/quality-inspection/fake-sor.ts',
    function: 'demoSeed',
    reason: 'demo fixture data returned by the fake system of record',
  },
];
