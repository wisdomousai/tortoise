/**
 * Small DOM and SVG builders for the overview views. The views use no framework, so the
 * documentation site and a standalone page render the same code.
 */
import type { Overview } from '../../../../scripts/overview';

export type { Overview };

/** Where a reference points. The site resolves these to its own pages; a standalone page to GitHub. */
export interface Links {
  /** A guide as `page` or `page#anchor` under `docs/`. */
  doc(reference: string): string;
  /** A workspace directory such as `packages/runtime`. */
  workspace(directory: string): string;
  /** A source file or directory. */
  source(path: string): string;
}

export type View = (element: HTMLElement, data: Overview, links: Links) => (() => void) | void;

type Attribute = string | number | boolean | undefined | EventListener;
type Child = Node | string | false | null | undefined;
/** Children nest freely; `append` flattens them. */
type Children = ReadonlyArray<Child | Children>;

function apply(element: Element, attributes: Record<string, Attribute>) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, ''), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(element: Element, children: Children) {
  for (const child of children)
    if (Array.isArray(child)) append(element, child);
    else if (child !== false && child !== null && child !== undefined)
      element.append(typeof child === 'string' ? document.createTextNode(child) : (child as Node));
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, Attribute> = {},
  ...children: Children
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  apply(element, attributes);
  append(element, children);
  return element;
}

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, Attribute> = {},
  ...children: Children
): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(element, attributes);
  append(element, children);
  return element;
}

/** Text with `backtick` spans rendered as code. */
export function inline(text: string): Node[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('`') ? h('code', {}, part.slice(1, -1)) : document.createTextNode(part),
    );
}

export function link(href: string, ...children: Child[]) {
  const external = /^https?:/.test(href);
  return h(
    'a',
    { href, ...(external ? { target: '_blank', rel: 'noreferrer' } : {}) },
    ...children,
  );
}

/** The short name of a workspace: `@tortoise/runtime` becomes `runtime`. */
export const shortName = (name: string) => name.replace(/^@tortoise\//, '');

/** A row of toggle buttons; `select` runs with the chosen id and once for the initial one. */
export function segmented(
  label: string,
  options: ReadonlyArray<{ readonly id: string; readonly title: string }>,
  initial: string,
  select: (id: string) => void,
) {
  const buttons = options.map((option) =>
    h(
      'button',
      {
        type: 'button',
        class: 'ov-segment',
        'aria-pressed': String(option.id === initial),
        onclick: () => choose(option.id),
      },
      option.title,
    ),
  );
  const choose = (id: string) => {
    buttons.forEach((button, index) =>
      button.setAttribute('aria-pressed', String(options[index]!.id === id)),
    );
    select(id);
  };
  return h('div', { class: 'ov-segments', role: 'group', 'aria-label': label }, buttons);
}

/** Tests as `name` with the file linked. */
export function testList(tests: ReadonlyArray<{ file: string; test: string }>, links: Links) {
  return h(
    'ul',
    { class: 'ov-tests' },
    tests.map((test) =>
      h(
        'li',
        {},
        h('q', {}, test.test),
        ' ',
        link(links.source(test.file), h('code', {}, test.file)),
      ),
    ),
  );
}

/**
 * A table whose cells carry their column heading, so a narrow screen can show each row as a
 * stack of labelled cells.
 */
export function table(
  className: string,
  headings: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<Child | Children>>,
) {
  return h(
    'div',
    { class: 'ov-table-wrap' },
    h(
      'table',
      { class: `ov-table ${className}`.trim() },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          headings.map((heading) => h('th', {}, heading)),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((cells) =>
          h(
            'tr',
            {},
            cells.map((cell, index) => h('td', { 'data-label': headings[index] }, [cell])),
          ),
        ),
      ),
    ),
  );
}
