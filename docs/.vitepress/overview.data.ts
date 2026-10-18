/**
 * The overview map's data, read at build time from what `bun run generate` wrote. `docs:dev` and
 * `docs:build` run `generate` first; a missing file fails the build with the command to run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Overview } from '../../scripts/overview';
import { repoRoot } from './sidebar';

const file = join(repoRoot, 'dist', 'reference', 'overview.json');

declare const data: Overview;
export { data };

export default {
  watch: ['../../dist/reference/overview.json'],
  load(): Overview {
    if (!existsSync(file)) throw new Error(`${file} is missing; run bun run generate`);
    return JSON.parse(readFileSync(file, 'utf8')) as Overview;
  },
};
