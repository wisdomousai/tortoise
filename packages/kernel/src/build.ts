import type { ApplicationManifest } from './manifest';

const DAY_MS = 86_400_000;

/**
 * When the running binary was built. The build that compiles it stamps the definition
 * (`stampBuild`); a run from source has none.
 */
export interface BuildStamp {
  /** ISO timestamp. */
  readonly builtAt: string;
}

/** What a host reports about its build: when it was built and, with a shelf life, its best-before date. */
export interface BuildFacts {
  readonly builtAt: string;
  readonly shelfLifeDays?: number;
  /** `YYYY-MM-DD` in UTC: the build date plus the shelf life. */
  readonly bestBefore?: string;
}

/** The UTC calendar date `shelfLifeDays` after `builtAt`, as `YYYY-MM-DD`. */
export function bestBeforeDate(builtAt: string, shelfLifeDays: number): string {
  const built = Date.parse(builtAt);
  if (!Number.isFinite(built)) throw new Error(`Invalid build time "${builtAt}"`);
  return new Date(built + shelfLifeDays * DAY_MS).toISOString().slice(0, 10);
}

/** True from the day after `bestBefore`; the date itself is still within the shelf life. */
export function pastBestBefore(bestBefore: string, now = Date.now()): boolean {
  return now >= Date.parse(`${bestBefore}T00:00:00Z`) + DAY_MS;
}

/**
 * The definition as a build of it runs: the build step that compiles a binary calls this in the
 * generated entry, so the host can tell when it was built.
 */
export function stampBuild<Definition extends { readonly build?: BuildStamp }>(
  definition: Definition,
  builtAt: string,
): Definition {
  if (!Number.isFinite(Date.parse(builtAt))) throw new Error(`Invalid build time "${builtAt}"`);
  return Object.freeze({ ...definition, build: { builtAt } });
}

/** The build facts of a stamped definition, or undefined for a run from source. */
export function buildFacts(
  manifest: Pick<ApplicationManifest, 'shelfLifeDays'>,
  build: BuildStamp | undefined,
): BuildFacts | undefined {
  if (!build) return undefined;
  const { shelfLifeDays } = manifest;
  return shelfLifeDays === undefined
    ? { builtAt: build.builtAt }
    : {
        builtAt: build.builtAt,
        shelfLifeDays,
        bestBefore: bestBeforeDate(build.builtAt, shelfLifeDays),
      };
}
