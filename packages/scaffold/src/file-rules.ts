import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/** Which files of a checkout a scaffold exports. Credentials and local state never qualify. */
const rootFiles = new Set([
  'package.json',
  'app.config.json',
  'bun.lock',
  'tsconfig.json',
  'playwright.config.ts',
  'README.md',
  'LICENSE',
  'AGENTS.md',
  'IMPLEMENTATION_PLAN.md',
  '.gitignore',
  '.prettierrc.json',
  '.prettierignore',
]);
const sourceDirectories = new Set([
  'packages',
  'plugins',
  'apps',
  'examples',
  'scripts',
  'skills',
  'docs',
  'tests',
  '.github',
]);
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'artifacts',
  'test-results',
  'playwright-report',
  'coverage',
  '.git',
  '.codex',
  '.agents',
  '.aws',
  '.workspace',
  'workspace',
  'workspaces',
  'data',
  'credentials',
  'profiles',
  'provider-runs',
  'provider-conversations',
]);
const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.sh',
  '.py',
  '.toml',
  '.svg',
]);
export function allowedFile(path: string): boolean {
  const name = basename(path);
  if (['.connection.json', 'connection.json', 'session.json', 'sessions.json'].includes(name))
    return false;
  if (
    name.startsWith('.env') ||
    /(?:secret|credential|token|private[-_]?key).*\.(?:json|pem|key|p12)$/i.test(name)
  )
    return false;
  return rootFiles.has(path) || sourceExtensions.has(extname(name));
}
/** Source files of a checkout, without symlinks, build output, workspaces or credentials. */
export async function collect(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          !excludedDirectories.has(entry.name) &&
          !entry.name.startsWith('.scaffold-') &&
          (path || sourceDirectories.has(entry.name))
        )
          await walk(child);
      } else if (entry.isFile() && (path || rootFiles.has(entry.name)) && allowedFile(child))
        files.push(child);
    }
  }
  await walk('');
  return files.sort();
}
