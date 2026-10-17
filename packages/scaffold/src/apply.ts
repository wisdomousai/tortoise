import { extend } from './markers';
import type { Generated } from './templates/collection';

/**
 * Apply a generated part to an application's files in memory. A new file must not exist yet and
 * every edited file must hold the markers the part extends, so a failure changes nothing.
 */
export function applyGenerated(
  files: Readonly<Record<string, string>>,
  part: Generated,
): Record<string, string> {
  const result: Record<string, string> = { ...files };
  for (const path of Object.keys(part.files))
    if (Object.hasOwn(result, path)) throw new Error(`Refusing to overwrite ${path}`);
  for (const [path, insertions] of Object.entries(part.insertions)) {
    if (!Object.hasOwn(result, path)) throw new Error(`The application has no ${path}`);
    result[path] = extend(result[path]!, insertions);
  }
  return { ...result, ...part.files };
}
