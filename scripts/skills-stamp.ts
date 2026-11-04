/**
 * Records the public API the skills were reviewed against in `scripts/reviewed-api.json`:
 * each package, plugin and SDK's entrypoints and exported names, and the root package scripts.
 * Run it after reviewing the skills that `bun run check:skills` names for a changed public API, and
 * commit the file with the skill changes, so the diff shows what was reviewed. Without arguments
 * it records every workspace; with workspace paths (or `package.json`) only those.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentApi } from './skill-api';
import { reviewedApiFile, root, rootScripts } from './skills';

const path = join(root, reviewedApiFile);
const current = currentApi(root);
let recorded: Record<string, string[]> = {};
try {
  recorded = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string[]>;
} catch {}
const only = process.argv
  .slice(2)
  .map((argument) => (argument === 'package.json' ? rootScripts : argument.replace(/\/$/, '')));
const next: Record<string, string[]> = {};
for (const key of Object.keys(current).sort())
  next[key] = only.length && !only.includes(key) && recorded[key] ? recorded[key]! : current[key]!;
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `Recorded the reviewed public API of ${only.length ? only.join(', ') : 'every workspace'}.`,
);
