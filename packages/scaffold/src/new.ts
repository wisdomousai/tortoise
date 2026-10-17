import { applyGenerated } from './apply';
import { displayNameOf, scaffold, type ScaffoldManifest } from './scaffold';
import { applicationFiles, type AppNames } from './templates/application';
import { collection } from './templates/collection';
import { names, plural } from './templates/names';

export interface NewOptions {
  readonly target: string;
  readonly name: string;
  readonly displayName?: string;
  /** The first collection's record type; `item` when omitted. */
  readonly collection?: string;
  readonly sourceRoot?: string;
}

/** The names a generated application is written with. */
export function appNames(name: string, displayName: string): AppNames {
  const app = names(name, 'Application name');
  // The display name also appears inside generated block comments.
  if (displayName.includes('*/')) throw new Error('Display name cannot contain */');
  return { app, displayName, packageName: `@${app.kebab}/application` };
}

/**
 * Export the framework and the starter with a new, empty application as the only content: a
 * manifest, application and screens entrypoint, one collection with its default screens, the
 * site, network, audit and compliance plugins, a cross-surface conformance test, a UI-binding
 * test and a behavioral test. No example is copied.
 */
export async function scaffoldNew(options: NewOptions): Promise<ScaffoldManifest> {
  const displayName = displayNameOf(options);
  const app = appNames(options.name, displayName);
  const first = names(options.collection ?? 'item', 'Collection type');
  const files = applyGenerated(
    await applicationFiles(app, first, `/${plural(first).kebab}`),
    collection(app, first),
  );
  return scaffold({
    target: options.target,
    name: options.name,
    displayName,
    ...(options.sourceRoot ? { sourceRoot: options.sourceRoot } : {}),
    content: { directory: `examples/${app.app.kebab}`, packageName: app.packageName, files },
  });
}
