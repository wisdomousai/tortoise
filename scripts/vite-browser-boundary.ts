import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { forbiddenBrowserImport, hostSourcePath } from './boundary-rules.ts';

/**
 * Fail the browser build when the real dependency graph reaches a host-only module, directly or
 * transitively. Static import scans miss re-exports and dependencies of dependencies; the
 * bundler's own resolution does not.
 */
export function browserBoundary(root = process.cwd()): Plugin {
  const name = (id: string) => relative(root, id).replaceAll('\\', '/');
  // An installed framework package is judged by the directory it was published from, so
  // `node_modules/@agent-native/runtime/src/x.ts` meets the rule for `packages/runtime/src/`.
  const published = new Map<string, string | undefined>();
  const sourcePath = (id: string) => {
    const installed = /^(.*[\\/]node_modules[\\/]@agent-native[\\/][^\\/]+)[\\/](.*)$/.exec(id);
    if (!installed) return id;
    const [, directory, rest] = installed as unknown as [string, string, string];
    if (!published.has(directory))
      try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
          repository?: { directory?: string };
        };
        published.set(directory, manifest.repository?.directory);
      } catch {
        published.set(directory, undefined);
      }
    const source = published.get(directory);
    return source ? `${source}/${rest}` : id;
  };
  return {
    name: 'agent-native-browser-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && forbiddenBrowserImport.test(source))
        this.error(`${name(importer)}: browser imports host module ${source}`);
      return null;
    },
    load(id) {
      if (hostSourcePath.test(sourcePath(id)))
        this.error(`Browser bundle includes host module ${name(id)}`);
      return null;
    },
  };
}
