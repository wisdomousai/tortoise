import { relative } from 'node:path';
import type { Plugin } from 'vite';
import { forbiddenBrowserImport, hostSourcePath } from './boundary-rules.ts';

/**
 * Fail the browser build when the real dependency graph reaches a host-only module, directly or
 * transitively. Static import scans miss re-exports and dependencies of dependencies; the
 * bundler's own resolution does not.
 */
export function browserBoundary(root = process.cwd()): Plugin {
  const name = (id: string) => relative(root, id).replaceAll('\\', '/');
  return {
    name: 'agent-native-browser-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && forbiddenBrowserImport.test(source))
        this.error(`${name(importer)}: browser imports host module ${source}`);
      return null;
    },
    load(id) {
      if (hostSourcePath.test(id)) this.error(`Browser bundle includes host module ${name(id)}`);
      return null;
    },
  };
}
