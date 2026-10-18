/**
 * The mechanical part of `docs/styleguide.md`: the rules `check-docs` can decide from text alone.
 * Each rule has a name the styleguide cites and a message the finding prints. Prose is examined
 * sentence by sentence after code fences, tables, frontmatter, links and inline code are removed,
 * so an identifier or a URL never trips a prose rule. Reads nothing; pure functions over text.
 */

export interface Finding {
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

/** The longest sentence the styleguide allows, in words. */
export const sentenceWordLimit = 35;
/** The longest heading the styleguide allows, in words. */
export const headingWordLimit = 6;
/** Inline items at or past this count must become a list when the sentence is long. */
export const inlineItemLimit = 4;

const numberWords =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|a few';

/** Phrases that announce or decorate instead of stating. */
export const rhetoric: ReadonlyArray<{ readonly pattern: RegExp; readonly message: string }> = [
  { pattern: /\bshapes? the design\b/i, message: 'state the design choice directly' },
  { pattern: /\bin other words\b/i, message: 'say it once' },
  { pattern: /\bput differently\b/i, message: 'say it once' },
  { pattern: /\bnote that\b/i, message: 'drop the lead-in' },
  { pattern: /\bit is worth (noting|mentioning)\b/i, message: 'drop the lead-in' },
  { pattern: /\bimportantly\b/i, message: 'drop the intensifier' },
  { pattern: /\bcrucially\b/i, message: 'drop the intensifier' },
  { pattern: /\bthe point is\b/i, message: 'state the point' },
  { pattern: /\bsimply\b/i, message: 'drop the adverb' },
  { pattern: /\bof course\b/i, message: 'drop the aside' },
  { pattern: /\bneedless to say\b/i, message: 'drop the aside' },
  { pattern: /\bat its (core|heart)\b/i, message: 'drop the flourish' },
  { pattern: /\bunder the hood\b/i, message: 'name the mechanism' },
  { pattern: /\bbattle-tested\b/i, message: 'name the evidence' },
  { pattern: /\bseamless(ly)?\b/i, message: 'name what happens' },
  { pattern: /\brobust(ly)?\b/i, message: 'name the guarantee' },
  { pattern: /\bpowerful\b/i, message: 'name the capability' },
  { pattern: /\belegant(ly)?\b/i, message: 'drop the judgment' },
  { pattern: /\bleverages?\b/i, message: 'use "uses"' },
  { pattern: /\bdelve\b/i, message: 'use "read" or "look at"' },
  { pattern: /\btapestry\b/i, message: 'name the thing' },
  { pattern: /\bjourney\b/i, message: 'name the steps' },
  { pattern: /\bfirst-class\b/i, message: 'say what it has' },
  { pattern: /\bout of the box\b/i, message: 'say "by default"' },
  { pattern: /, or nothing\b/i, message: 'say "or the command fails" or similar' },
  {
    pattern: new RegExp(
      `^(${numberWords}) (choices|things|parts|rules|ideas|reasons|facts|points|principles|decisions|kinds|layers)\\b`,
      'i',
    ),
    message: 'counting lead-in; list the items instead',
  },
  {
    pattern: new RegExp(
      `^(the|this|its) (model|design|pattern|system|framework) has (${numberWords}) \\w+[.:]`,
      'i',
    ),
    message: 'counting lead-in; list the items instead',
  },
  { pattern: /\bnever stands in for\b/i, message: 'aphorism; state the rule' },
  { pattern: /\?\s*$/, message: 'rhetorical question; state the answer' },
];

/** Headings must be short noun phrases in sentence case. */
export function headingFindings(heading: string, line: number): Finding[] {
  const findings: Finding[] = [];
  const text = heading.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > headingWordLimit)
    findings.push({
      line,
      rule: 'heading-form',
      message: `heading has ${words.length} words; limit is ${headingWordLimit}`,
    });
  if (/[.!?:;,]$/.test(text))
    findings.push({ line, rule: 'heading-form', message: 'heading ends with punctuation' });
  if (/\?/.test(text))
    findings.push({ line, rule: 'heading-form', message: 'heading is a question' });
  if (/, not\b|\bnot\b.*\bbut\b|\bvs\.?\b|\bversus\b/i.test(text))
    findings.push({ line, rule: 'heading-form', message: 'heading is a contrast; name the topic' });
  if (new RegExp(`^(${numberWords}|\\d+[.)]?)\\s`, 'i').test(text))
    findings.push({
      line,
      rule: 'heading-form',
      message: 'heading starts with a count; name the topic',
    });
  if (/[:—–-]\s/.test(text) && !/^@/.test(text))
    findings.push({
      line,
      rule: 'heading-form',
      message: 'heading has a subtitle; keep one noun phrase',
    });
  if (/^(how|why|what|when|where|which)\b/i.test(text))
    findings.push({
      line,
      rule: 'heading-form',
      message: 'heading is a question stem; name the topic',
    });
  return findings;
}

/** Replaces links, inline code and emphasis with placeholders so prose rules see only prose. */
export function stripMarkup(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, 'image')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, 'Code')
    .replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '');
}

/** Splits prose into sentences. Abbreviations and decimals are kept together. */
export function sentences(text: string): string[] {
  const guarded = text
    .replace(/\b(e\.g|i\.e|etc|vs|cf|Mr|Mrs|Dr|No|Fig|Inc|Ltd)\./g, '$1<dot>')
    .replace(/(\d)\.(\d)/g, '$1<dot>$2');
  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/<dot>/g, '.').trim())
    .filter(Boolean);
}

/** Comma-separated items in a sentence, counting an Oxford "and" or "or" as the last item. */
function inlineItems(sentence: string): number {
  const withoutParens = sentence
    .replace(/\([^)]*\)/g, '')
    .replace(/\bhttps?:\/\/\S+/g, 'url')
    // A comma that opens a clause separates no item.
    .replace(
      /,\s+(so|because|which|who|but|and (if|when|then)|if|when|while|where|although|unless|since|whereas)\b/g,
      ' $1',
    );
  const commas = (withoutParens.match(/,/g) ?? []).length;
  // "a, b, c and d" has two commas and four items; "a, b and c" has one comma and three items.
  const oxford = /,\s*(and|or)\s/.test(withoutParens) ? 1 : 2;
  return commas === 0 ? 1 : commas + oxford;
}

/** Findings for one prose sentence. */
export function sentenceFindings(sentence: string, line: number): Finding[] {
  const findings: Finding[] = [];
  // A glossary's "Do not use" line is data: a list of words, each with the sense it is banned in.
  if (/^Do not use:/.test(sentence)) return findings;
  const words = sentence.split(/\s+/).filter(Boolean).length;
  if (words > sentenceWordLimit)
    findings.push({
      line,
      rule: 'sentence-length',
      message: `${words} words; limit is ${sentenceWordLimit}: "${sentence.slice(0, 60)}…"`,
    });
  const items = inlineItems(sentence);
  // Four short nouns in a row read fine; four clauses do not. Length decides.
  if (items >= inlineItemLimit && words > 30)
    findings.push({
      line,
      rule: 'inline-enumeration',
      message: `${items} comma-separated items in ${words} words; use a list: "${sentence.slice(0, 60)}…"`,
    });
  const soCount = (sentence.match(/,\s*so\s/g) ?? []).length;
  if (soCount >= 2)
    findings.push({ line, rule: 'clause-chain', message: 'two "so" clauses in one sentence' });
  if (/[—]/.test(sentence)) findings.push({ line, rule: 'punctuation', message: 'em-dash' });
  if (/\([^()]*\(/.test(sentence))
    findings.push({ line, rule: 'punctuation', message: 'nested parentheses' });
  if ((sentence.match(/\(/g) ?? []).length > 1)
    findings.push({
      line,
      rule: 'punctuation',
      message: 'more than one parenthetical in a sentence',
    });
  for (const { pattern, message } of rhetoric)
    if (pattern.test(sentence))
      findings.push({ line, rule: 'rhetoric', message: `${message}: "${sentence.slice(0, 60)}…"` });
  return findings;
}

export interface Term {
  readonly canonical: string;
  readonly banned: readonly string[];
}

/**
 * Banned synonyms from the glossary: every `Do not use:` line under a `### Term` heading lists
 * the words the canonical term replaces, separated by commas. An entry with a qualifier in
 * parentheses, such as `page (for a screen)`, is guidance for a reviewer and is not checked,
 * because the bare word has other legitimate senses. Only unqualified entries are checked.
 */
export function glossaryTerms(glossary: string): Term[] {
  const terms: Term[] = [];
  let canonical = '';
  for (const line of glossary.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) canonical = heading[1]!;
    const banned = /^\*?\*?Do not use:?\*?\*?:?\s*(.+)$/i.exec(line);
    if (banned && canonical)
      terms.push({
        canonical,
        banned: banned[1]!
          .replace(/\([^)]*\)/g, '\u0000')
          .split(',')
          .map((entry) => entry.trim().replace(/^["'`]|["'`.]$/g, ''))
          .filter((entry) => entry && !entry.includes('\u0000')),
      });
  }
  return terms;
}

/** Findings for banned synonyms in a prose line (markup already stripped). */
export function termFindings(prose: string, line: number, terms: readonly Term[]): Finding[] {
  const findings: Finding[] = [];
  for (const { canonical, banned } of terms)
    for (const synonym of banned) {
      const pattern = new RegExp(
        `(?<![\\w/-])${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
        'i',
      );
      if (pattern.test(prose))
        findings.push({
          line,
          rule: 'terms',
          message: `"${synonym}" is not a glossary term; use "${canonical}"`,
        });
    }
  return findings;
}
