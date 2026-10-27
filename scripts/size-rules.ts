/**
 * Thresholds for `check:size`. A long file or function is worth a second look, nothing more: the
 * check reports them and does not fail. Split by responsibility when one is there to split, not
 * to get under a number.
 */
export const maxFileLines = 300;
export const maxFunctionLines = 80;

/** Workspace sources that `check:size` measures. Tests, browser tests and generated output are exempt. */
export const measuredSource =
  /^(?:packages|workstations|plugins|apps|examples|patterns)\/.+\.[cm]?[jt]sx?$/;
export const exemptSource =
  /(?:\.test\.|\.pw\.ts$|\.d\.ts$|\/test\/|\/e2e\/|\/generated\/|\/dist\/|\/node_modules\/)/;

/** Package entrypoints that may only re-export (`export … from`); implementation lives beside them. */
export const barrel = /^(?:packages|workstations|plugins)\/[^/]+\/src\/index\.tsx?$/;
