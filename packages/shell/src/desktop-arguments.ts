/** Links in the application's scheme and file paths a desktop process was asked to open. */
export interface DesktopArguments {
  readonly urls: readonly string[];
  readonly paths: readonly string[];
}

/** More entries than this in one launch are ignored; no OS sends that many at once. */
const maxEntries = 16;

/**
 * A POSIX absolute path or a Windows drive path. A UNC path (`\\server\share` or `//server/share`)
 * is refused: opening it makes Windows authenticate to the named server.
 */
const absolutePath = /^(?:\/(?!\/)|[A-Za-z]:\\)/;

function classify(entry: unknown, scheme: string, into: { urls: string[]; paths: string[] }): void {
  if (typeof entry !== 'string' || /[\u0000\r\n]/.test(entry)) return;
  if (into.urls.length + into.paths.length >= maxEntries) return;
  if (entry.toLowerCase().startsWith(`${scheme}:`) && entry.length <= 2048) into.urls.push(entry);
  else if (absolutePath.test(entry) && !entry.startsWith('\\\\') && entry.length <= 4096)
    into.paths.push(entry);
}

/**
 * The OS input in a desktop command line. When `--` is present only the arguments after it
 * count: registrations put the link or file there, so a link that smuggles a quote and a
 * `--switch` into the command line cannot add an argument that is read. Without `--` (a file
 * association that passes only the path) everything after the first `skip` entries that does not
 * start with `-` counts. An entry is a link when it starts with `scheme:`, a file when it is an
 * absolute local path; anything else is ignored.
 */
export function desktopArguments(
  argv: readonly string[],
  scheme: string,
  skip: number,
): DesktopArguments {
  const separator = argv.indexOf('--');
  const candidates =
    separator >= 0
      ? argv.slice(separator + 1)
      : argv.slice(skip).filter((entry) => !entry.startsWith('-'));
  const found = { urls: [] as string[], paths: [] as string[] };
  for (const entry of candidates) classify(entry, scheme, found);
  return found;
}

/**
 * Arguments another process handed over, such as the data a second instance passes to the
 * running one. The value is untrusted, so every entry is classified again.
 */
export function receivedArguments(value: unknown, scheme: string): DesktopArguments {
  const found = { urls: [] as string[], paths: [] as string[] };
  const fields = (value ?? {}) as { urls?: unknown; paths?: unknown };
  for (const list of [fields.urls, fields.paths])
    if (Array.isArray(list)) for (const entry of list) classify(entry, scheme, found);
  return found;
}

/** The last segment of a POSIX or Windows path. */
export function pathName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}
