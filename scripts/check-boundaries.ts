import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';

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
const browserRoots = ['packages/contracts/', 'packages/client/', 'packages/react/', 'apps/web/'];
const forbidden =
  /^(?:node:|bun:|@agent-native\/(?:runtime|agents|adapters)(?:\/|$)|@anthropic-ai\/|@napi-rs\/|electron$|ai$)/;
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
      (forbidden.test(dependency) ||
        /(?:packages\/)?(?:agents|adapters|runtime)\/src/.test(dependency))
    )
      errors.push(`${name}: browser imports host module ${dependency}`);
  }
}
// Bundling the actual application catches transitive host dependencies as well as direct ones.
const build = await Bun.build({
  entrypoints: [resolve(root, 'apps/web/src/main.tsx')],
  target: 'browser',
});
if (!build.success) errors.push(...build.logs.map((log) => log.message));
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Checked ${all.length} source files and browser dependency graph`);
