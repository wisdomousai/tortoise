import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { plural, type Names } from './names';
import { prefixed, render } from './render';

/** The application a `scaffold new` creates, before its first collection is added. */
export interface AppNames {
  readonly app: Names;
  readonly displayName: string;
  /** Package of the content workspace, for example `@field-notes/application`. */
  readonly packageName: string;
}

/** The skeleton's files are `.tpl` text, so no code check reads their imports as the scaffold's. */
const SKELETON = join(import.meta.dir, '../../templates/application');

const packageJson = ({ packageName }: AppNames) =>
  `${JSON.stringify(
    {
      name: packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'bun ../../../scripts/dev-desktop.ts --port 4330',
        'dev:web': 'bun ../../../scripts/dev-example.ts --port 4330',
      },
      exports: { './screens': './screens.tsx', './*': './*.ts' },
    },
    null,
    2,
  )}\n`;

async function templates(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true }))
    if (entry.isFile() && entry.name.endsWith('.tpl'))
      found.push(join(entry.parentPath, entry.name));
  return found.sort();
}

/**
 * Every file a new application has besides its parts: the three entrypoints, contracts, domain,
 * policy, server and handler context with their `// scaffold:<list>` markers, a cross-surface
 * conformance test over the first collection's list, a UI-binding test, a browser test of the
 * first collection's default screens and the README.
 */
export async function applicationFiles(
  names: AppNames,
  first: Names,
  home: string,
): Promise<Record<string, string>> {
  const values = {
    ...prefixed('app', names.app),
    ...prefixed('one', first),
    ...prefixed('many', plural(first)),
    displayName: names.displayName,
    'displayName.literal': JSON.stringify(names.displayName),
    packageName: names.packageName,
    home,
    tool: `${first.kebab}.list`.replace(/[.-]/g, '_'),
  };
  const files: Record<string, string> = { 'package.json': packageJson(names) };
  for (const path of await templates(SKELETON))
    files[relative(SKELETON, path).slice(0, -'.tpl'.length)] = render(
      await readFile(path, 'utf8'),
      values,
    );
  return files;
}
