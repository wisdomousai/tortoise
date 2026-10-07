import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { build } from 'vite';
import {
  browserSource,
  directEgress,
  egressExemptions,
  forbiddenBrowserImport,
  hostSourcePath,
  serverSource,
} from './boundary-rules.ts';

const root = resolve(import.meta.dir, '..');
const errors: string[] = [];
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (/\.[cm]?[jt]sx?$/.test(path) && !path.includes('.test.') && !path.endsWith('.pw.ts'))
      result.push(path);
  }
  return result;
}
const all = await files(root);
const browserRoots = [
  'packages/contracts/',
  'packages/client/',
  'packages/react/',
  'packages/devices/src/',
  'packages/operator-ui/',
  'apps/web/src/',
];
for (const file of all) {
  const name = relative(root, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g,
    ),
  ].map((match) => match[1] ?? match[2]!);
  for (const dependency of imports) {
    if (name.startsWith('packages/') && /^(?:\.\.\/)+(?:apps|examples)\//.test(dependency))
      errors.push(`${name}: framework imports feature ${dependency}`);
    if (
      browserRoots.some((prefix) => name.startsWith(prefix)) &&
      // A server entrypoint inside a browser-safe package (devices/server) is itself host code.
      !hostSourcePath.test(file) &&
      (forbiddenBrowserImport.test(dependency) ||
        hostSourcePath.test(resolve(file, '..', dependency)))
    )
      errors.push(`${name}: browser imports host module ${dependency}`);
  }
}
// Server code connects to other hosts only through the egress guard; see `egressExemptions`.
const exemptionUsed = new Set<string>();
for (const file of all) {
  const name = relative(root, file).replaceAll('\\', '/');
  if (!serverSource.test(name) || browserSource.test(name)) continue;
  // Comments mention APIs without calling them.
  const source = (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const found = directEgress.filter((rule) => rule.pattern.test(source)).map((rule) => rule.api);
  if (!found.length) continue;
  const exemption = Object.keys(egressExemptions).find((prefix) => name.startsWith(prefix));
  if (exemption) exemptionUsed.add(exemption);
  else errors.push(`${name}: direct ${found.join(', ')} bypasses the egress guard`);
}
for (const exemption of Object.keys(egressExemptions))
  if (!exemptionUsed.has(exemption))
    errors.push(`scripts/boundary-rules.ts: stale egress exemption ${exemption}`);
// Bundling the actual application with its real config catches transitive host dependencies as
// well as direct ones: the boundary plugin in apps/web/vite.config.ts fails the graph.
try {
  await build({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Checked ${all.length} source files and browser dependency graph`);
