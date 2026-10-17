/**
 * Syntax shared by OS handler validation and the matcher that applies handlers at runtime. Pure
 * functions; they never touch request data beyond the strings they are given.
 */

const placeholder = /\{([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)\}/g;
const segmentParameter = /^:([a-zA-Z][a-zA-Z0-9]*)$/;
const literalSegment = /^[a-zA-Z0-9._~-]+$/;

/** Names in a template, in order. Throws on a brace that is not part of a placeholder. */
export function templatePlaceholders(template: string): readonly string[] {
  const names = [...template.matchAll(placeholder)].map((match) => match[1]!);
  if (/[{}]/.test(template.replace(placeholder, '')))
    throw new Error(`Malformed template: ${template}`);
  return names;
}

/** True when the template is exactly one placeholder, so it yields the raw value. */
export function isWholePlaceholder(template: string): boolean {
  return /^\{[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?\}$/.test(template);
}

/**
 * Segments of a link path: literal segments and `:name` parameters. The path is absolute, has no
 * empty segment, query or fragment, and names each parameter once.
 */
export function linkPathSegments(
  path: string,
): readonly ({ readonly literal: string } | { readonly param: string })[] {
  if (!path.startsWith('/') || path.length > 256) throw new Error(`Invalid link path: ${path}`);
  const parts = path === '/' ? [] : path.slice(1).split('/');
  const seen = new Set<string>();
  return parts.map((part) => {
    const param = segmentParameter.exec(part)?.[1];
    if (param) {
      if (seen.has(param)) throw new Error(`Repeated link parameter ${param}: ${path}`);
      seen.add(param);
      return { param };
    }
    if (!literalSegment.test(part) || part === '.' || part === '..')
      throw new Error(`Invalid link path segment "${part}": ${path}`);
    return { literal: part };
  });
}

/** The path's shape with parameter names erased, for detecting two handlers on one path. */
export function linkPathShape(path: string): string {
  return linkPathSegments(path)
    .map((segment) => ('param' in segment ? ':' : segment.literal))
    .join('/');
}
