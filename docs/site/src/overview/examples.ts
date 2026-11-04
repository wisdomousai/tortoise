/**
 * One example at a time: what it takes in, which system of record it delivers to, what it
 * composes, and what its catalog declares on this machine, on the site network and on the
 * internet. The declarations come from the example's security manifest; a deployment policy binds them.
 */
import { h, inline, link, segmented, type Links, type Overview, type View } from './dom';

type Example = Overview['examples'][number];
type Destination = Example['network'][number];

const scopes: ReadonlyArray<readonly [scope: string, title: string]> = [
  ['loopback', 'This machine'],
  ['site', 'Site network'],
  ['internet', 'Internet'],
];

function destination(entry: Destination) {
  return h(
    'li',
    { class: `ov-declared is-${entry.availability}` },
    h(
      'span',
      { class: 'ov-declared-head' },
      h('code', {}, entry.id),
      h('span', { class: 'ov-badge' }, entry.direction === 'inbound' ? 'Inbound' : 'Outbound'),
      h('span', { class: 'ov-badge' }, entry.availability === 'required' ? 'Required' : 'Optional'),
      entry.offline && h('span', { class: 'ov-badge' }, `Offline: ${entry.offline}`),
    ),
    h('span', { class: 'ov-declared-text' }, entry.purpose),
  );
}

function group(title: string, items: readonly HTMLElement[]) {
  return (
    items.length > 0 && [
      h('p', { class: 'ov-label' }, title),
      h('ul', { class: 'ov-declarations' }, items),
    ]
  );
}

const simple = (entry: { id: string; purpose: string; kind?: string }) =>
  h(
    'li',
    { class: 'ov-declared' },
    h(
      'span',
      { class: 'ov-declared-head' },
      h('code', {}, entry.id),
      entry.kind && h('span', { class: 'ov-badge' }, entry.kind),
    ),
    h('span', { class: 'ov-declared-text' }, entry.purpose),
  );

function detail(data: Overview, example: Example, links: Links) {
  const plugin = (id: string) =>
    data.plugins.find((entry) => entry.kind === 'host-plugin' && entry.id === id);
  return [
    h('p', { class: 'ov-detail-title' }, link(links.workspace(example.directory), example.id)),
    h('p', {}, ...inline(example.lead)),
    h(
      'dl',
      { class: 'ov-facts' },
      h('dt', {}, 'Input'),
      h('dd', {}, example.input),
      h('dt', {}, 'System of record'),
      h('dd', {}, example.record),
      h('dt', {}, 'Catalog'),
      h(
        'dd',
        {},
        `${example.commands} commands and ${example.queries} queries`,
        example.targets.length > 0 && [
          ', targets ',
          ...example.targets.flatMap((target, index) => [index ? ', ' : '', h('code', {}, target)]),
        ],
      ),
      h('dt', {}, 'Plugins'),
      h(
        'dd',
        { class: 'ov-inline-list' },
        example.plugins.map((id) => {
          const entry = plugin(id);
          return entry ? link(links.workspace(entry.directory), id) : h('span', {}, id);
        }),
      ),
    ),
    h(
      'div',
      { class: 'ov-scopes' },
      scopes.map(([scope, title]) => {
        const network = example.network.filter((entry) => entry.scope === scope).map(destination);
        const local =
          scope === 'loopback'
            ? [
                group('Child processes', example.processes.map(simple)),
                group('Devices', example.devices.map(simple)),
                group('Exchange folders', example.folders.map(simple)),
              ]
            : [];
        return h(
          'section',
          { class: 'ov-scope', 'aria-label': title },
          h('p', { class: 'ov-scope-title' }, title),
          group('Network', network),
          local,
          !network.length &&
            !local.some(Boolean) &&
            h('p', { class: 'ov-muted' }, 'Nothing declared'),
        );
      }),
    ),
    h(
      'p',
      { class: 'ov-muted' },
      'Declarations from the security manifest. A deployment policy binds them; anything unbound is refused. Code: ',
      ...example.sources.flatMap((source, index) => [
        index ? ', ' : '',
        link(links.source(source), h('code', {}, source)),
      ]),
      '.',
    ),
  ];
}

export const examples: View = (element, data, links) => {
  const panel = h('div', { class: 'ov-detail', 'aria-live': 'polite' });
  const initial = data.examples.some((example) => example.id === 'winding-line')
    ? 'winding-line'
    : data.examples[0]!.id;
  const show = (id: string) =>
    panel.replaceChildren(
      ...(detail(
        data,
        data.examples.find((example) => example.id === id)!,
        links,
      ).filter(Boolean) as Node[]),
    );
  element.replaceChildren(
    h(
      'div',
      { class: 'ov-examples' },
      segmented(
        'Example',
        data.examples.map((example) => ({ id: example.id, title: example.id })),
        initial,
        show,
      ),
      panel,
    ),
  );
  show(initial);
};
