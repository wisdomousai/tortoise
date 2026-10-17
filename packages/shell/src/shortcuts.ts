import type { CatalogOs } from '@agent-native/contracts';

/** A launcher entry as a platform registers it: the handler id, its title and its link. */
export interface LauncherShortcut {
  readonly id: string;
  readonly title: string;
  /** The link the launcher opens the application with: `shortcutLink(scheme, id)`. */
  readonly link: string;
}

const shortcutIdPattern = /^[a-z0-9._-]{1,128}$/;

/**
 * The link a launcher entry opens: the application's scheme with an empty path and only the
 * `os-shortcut` parameter, `<scheme>:///?os-shortcut=<id>`, the form of the web manifest's
 * `/?os-shortcut=<id>`. The OS hands it over like any link (a desktop command line after `--`,
 * an Android VIEW intent), and the shell port reads it as a shortcut before matching links.
 */
export function shortcutLink(scheme: string, id: string): string {
  return `${scheme}:///?os-shortcut=${encodeURIComponent(id)}`;
}

/**
 * The shortcut id a link stands for, or `undefined` when it is not a shortcut link in one of
 * `schemes`: no host, an empty path, no credentials or fragment, and exactly one `os-shortcut`
 * parameter holding an id. Anyone can send such a link, as anyone can open the web landing; a
 * shortcut only opens or prefills.
 */
export function shortcutIdOf(raw: string, schemes: readonly string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!schemes.includes(url.protocol.slice(0, -1))) return undefined;
  if (url.host || (url.pathname !== '/' && url.pathname !== '') || url.hash) return undefined;
  if (url.username || url.password) return undefined;
  const keys = [...url.searchParams.keys()];
  const id = url.searchParams.get('os-shortcut');
  return keys.length === 1 && id !== null && shortcutIdPattern.test(id) ? id : undefined;
}

/** The declared shortcuts as launcher entries, in declaration order of the catalog. */
export function launcherShortcuts(os: CatalogOs | undefined, scheme: string): LauncherShortcut[] {
  return (os?.handlers ?? []).flatMap((handler) =>
    handler.kind === 'shortcut'
      ? [{ id: handler.id, title: handler.title, link: shortcutLink(scheme, handler.id) }]
      : [],
  );
}
