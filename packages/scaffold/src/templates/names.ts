/** Lowercase words joined by hyphens: application names, collection types, target names. */
export const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The spellings one hyphenated name takes in generated code and copy. */
export interface Names {
  /** `work-order`: operation IDs, journal types, file names. */
  readonly kebab: string;
  /** `workOrder`: variables and operation keys. */
  readonly camel: string;
  /** `WorkOrder`: types and permission subjects. */
  readonly pascal: string;
  /** `work order`: descriptions. */
  readonly words: string;
  /** `Work order`: headings and labels. */
  readonly title: string;
}

/** Spell `name` for code and copy; throws unless it is lowercase words joined by hyphens. */
export function names(name: string, what = 'Name'): Names {
  if (!KEBAB.test(name) || name.length > 60)
    throw new Error(`${what} must be lowercase words joined by hyphens: ${name}`);
  const parts = name.split('-');
  const pascal = parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
  const words = parts.join(' ');
  return {
    kebab: name,
    camel: pascal[0]!.toLowerCase() + pascal.slice(1),
    pascal,
    words,
    title: words[0]!.toUpperCase() + words.slice(1),
  };
}

/** The plural of a collection's names; a trailing `y` becomes `ies`, `s`/`x`/`ch`/`sh` add `es`. */
export function plural(one: Names): Names {
  const suffix = (word: string) =>
    /[^aeiou]y$/.test(word)
      ? `${word.slice(0, -1)}ies`
      : /(s|x|ch|sh)$/.test(word)
        ? `${word}es`
        : `${word}s`;
  return names(suffix(one.kebab));
}
