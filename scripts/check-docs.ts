/**
 * Checks the documentation corpus against the mechanical rules of `docs/styleguide.md`: working
 * links, heading form, sentence length, inline enumerations, clause chains, punctuation, rhetoric
 * and glossary terms. The corpus is `docs/**` (except `.vitepress`), the root `README.md` and
 * `AGENTS.md`, every workspace `README.md` and every `SKILL.md`. Findings print as
 * `path:line: rule: message`. Reads files only. Pass paths to check only those files, `--summary`
 * for counts per rule and file, or `--rule <name>` to see one rule.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { brokenLinks } from './markdown-links';
import {
  type Finding,
  glossaryTerms,
  headingFindings,
  sentenceFindings,
  sentences,
  stripMarkup,
  termFindings,
} from './docs-style-rules';
import { layers, root } from './skills';

const args = process.argv.slice(2);
const summary = args.includes('--summary');
const ruleIndex = args.indexOf('--rule');
const onlyRule = ruleIndex >= 0 ? args[ruleIndex + 1] : undefined;
const requested = args.filter(
  (arg, index) => !arg.startsWith('--') && (ruleIndex < 0 || index !== ruleIndex + 1),
);

function walk(directory: string, accept: (path: string) => boolean, into: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist')
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, accept, into);
    else if (accept(path)) into.push(path);
  }
}

/** Every file the styleguide governs. */
export function corpus(): string[] {
  const files: string[] = [];
  for (const name of ['README.md', 'AGENTS.md'])
    if (existsSync(join(root, name))) files.push(join(root, name));
  if (existsSync(join(root, 'docs')))
    walk(join(root, 'docs'), (path) => path.endsWith('.md'), files);
  for (const layer of layers) {
    const layerDirectory = join(root, layer);
    if (!existsSync(layerDirectory)) continue;
    for (const workspace of readdirSync(layerDirectory)) {
      const directory = join(layerDirectory, workspace);
      if (!statSync(directory).isDirectory()) continue;
      const readme = join(directory, 'README.md');
      if (existsSync(readme)) files.push(readme);
      const skills = join(directory, 'skills');
      if (existsSync(skills)) walk(skills, (path) => path.endsWith('SKILL.md'), files);
    }
  }
  if (existsSync(join(root, 'skills')))
    walk(join(root, 'skills'), (path) => path.endsWith('SKILL.md'), files);
  return files.sort();
}

const glossaryPath = join(root, 'docs', 'glossary.md');
const terms = existsSync(glossaryPath) ? glossaryTerms(readFileSync(glossaryPath, 'utf8')) : [];

/** Every guide must be in the site sidebar's `guides` list, or a reader cannot find it. */
export function sidebarFindings(): Finding[] {
  const sidebarPath = join(root, 'docs', '.vitepress', 'sidebar.ts');
  if (!existsSync(sidebarPath)) return [];
  const listed = new Set(
    [...readFileSync(sidebarPath, 'utf8').matchAll(/\['([a-z0-9-]+)',\s*'/g)].map((m) => m[1]),
  );
  const findings: Finding[] = [];
  for (const file of readdirSync(join(root, 'docs')))
    if (file.endsWith('.md') && !listed.has(file.slice(0, -3)))
      findings.push({
        line: 1,
        rule: 'sidebar',
        message: `docs/${file} is not in the guides list of docs/.vitepress/sidebar.ts`,
      });
  return findings;
}

/** Findings for one Markdown file. */
export function check(path: string): Finding[] {
  const text = readFileSync(path, 'utf8');
  const findings: Finding[] = brokenLinks(path, text).map((message) => ({
    line: 1,
    rule: 'links',
    message,
  }));
  const lines = text.split('\n');
  const headings = new Map<string, number>();
  let fenced = false;
  let frontmatter = lines[0] === '---';
  let paragraph: { start: number; text: string } | undefined;
  const isGlossary = path === glossaryPath;

  const flush = () => {
    if (!paragraph) return;
    const prose = stripMarkup(paragraph.text);
    for (const sentence of sentences(prose))
      findings.push(...sentenceFindings(sentence, paragraph.start));
    if (!isGlossary) findings.push(...termFindings(prose, paragraph.start, terms));
    paragraph = undefined;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (frontmatter) {
      if (index > 0 && raw === '---') frontmatter = false;
      return;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const trimmed = raw.trim();
    // An indented code block (four spaces after a blank line) is code, like a fenced one.
    if (/^( {4}|\t)/.test(raw) && !paragraph && (index === 0 || !lines[index - 1]!.trim())) return;
    // A table cell is checked as its own short sentence; its words and terms count.
    if (/^\|/.test(trimmed)) {
      flush();
      if (/^\|[\s:|-]+\|$/.test(trimmed)) return;
      for (const cell of trimmed.split('|').slice(1, -1)) {
        const prose = stripMarkup(cell.trim());
        if (!prose) continue;
        for (const sentence of sentences(prose)) findings.push(...sentenceFindings(sentence, line));
        if (!isGlossary) findings.push(...termFindings(prose, line, terms));
      }
      return;
    }
    // Comments, rules and block quotes (quoted examples of old text) are not prose here.
    if (!trimmed || /^<!--/.test(trimmed) || /^---+$/.test(trimmed) || /^>/.test(trimmed)) {
      flush();
      return;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(trimmed);
    if (heading) {
      flush();
      const title = stripMarkup(heading[1]!);
      if (index === 0 || /^# /.test(trimmed)) return; // the page title is the package or page name
      findings.push(...headingFindings(title, line));
      if (!isGlossary) findings.push(...termFindings(title, line, terms));
      const key = title.toLowerCase();
      if (headings.has(key))
        findings.push({
          line,
          rule: 'heading-form',
          message: `duplicate heading "${title}" (first at line ${headings.get(key)})`,
        });
      else headings.set(key, line);
      return;
    }
    // A list item or a table row is its own unit; a continuation line joins its paragraph.
    const item = /^\s*([-*+]|\d+[.)])\s+/.test(raw);
    if (item) flush();
    const content = item ? raw.replace(/^\s*([-*+]|\d+[.)])\s+/, '') : trimmed;
    if (paragraph) paragraph.text += ` ${content}`;
    else paragraph = { start: line, text: content };
  });
  flush();
  return findings.sort((a, b) => a.line - b.line);
}

if (import.meta.main) {
  const files = requested.length ? requested.map((path) => resolve(path)) : corpus();
  let total = 0;
  const perRule = new Map<string, number>();
  const perFile = new Map<string, number>();
  for (const file of files) {
    const name = relative(root, file);
    const own = name === 'docs/.vitepress/sidebar.ts' ? [] : check(file);
    const findings = [
      ...own,
      ...(requested.length ? [] : file === files[0] ? sidebarFindings() : []),
    ].filter((finding) => !onlyRule || finding.rule === onlyRule);
    for (const finding of findings) {
      total += 1;
      perRule.set(finding.rule, (perRule.get(finding.rule) ?? 0) + 1);
      perFile.set(name, (perFile.get(name) ?? 0) + 1);
      if (!summary) console.log(`${name}:${finding.line}: ${finding.rule}: ${finding.message}`);
    }
  }
  if (summary) {
    for (const [rule, count] of [...perRule].sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${rule}`);
    console.log('---');
    for (const [file, count] of [...perFile].sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${file}`);
  }
  console.log(
    total
      ? `${total} findings in ${perFile.size} of ${files.length} files.`
      : `${files.length} files follow the styleguide.`,
  );
  process.exit(total ? 1 : 0);
}
