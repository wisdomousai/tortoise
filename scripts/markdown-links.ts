/**
 * Relative Markdown links that point at a missing file or a missing heading. Used by the skill
 * checks. External links (`https:`, `mailto:` and the like) are not followed. Reads
 * files only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const headingCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
  let anchors = headingCache.get(file);
  if (!anchors) {
    anchors = new Set();
    const seen = new Map<string, number>();
    let fenced = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('```')) fenced = !fenced;
      const match = !fenced && /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
      if (!match) continue;
      const base = slug(match[1]!);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    headingCache.set(file, anchors);
  }
  return anchors;
}

/** One problem per broken relative link in the Markdown file at `path`. */
export function brokenLinks(path: string, text = readFileSync(path, 'utf8')): string[] {
  const problems: string[] = [];
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z+.-]*:/i.test(target!)) continue;
    const [file, anchor] = target!.split('#') as [string, string | undefined];
    const resolved = file ? resolve(dirname(path), file) : path;
    if (!existsSync(resolved)) problems.push(`link to missing file ${target}`);
    else if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor))
      problems.push(`link to missing heading ${target}`);
  }
  return problems;
}
