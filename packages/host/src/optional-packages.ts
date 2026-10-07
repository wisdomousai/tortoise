/**
 * Packages the service loads only when an optional adapter is configured, never at startup.
 * Standalone builds (`scripts/build-cli.ts`, the desktop sidecar in `scripts/package-stage.ts`)
 * mark them external instead of compiling them in: a compiled binary then resolves them from
 * `node_modules` relative to its working directory, and the adapter that needs one fails at
 * startup with a message naming the package when it is absent. Nothing else in the host graph
 * may import these statically.
 */
export const optionalHostPackages = ['@playwright/test'] as const;
