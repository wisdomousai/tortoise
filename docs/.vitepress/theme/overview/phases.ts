/**
 * The outbox effect phases and the transitions between them. The phases and their descriptions
 * come from `packages/runtime/src/effect-phase.ts`; selecting a phase lists its transitions.
 */
import { h, link, s, type View } from './dom';

const width = 96;
const height = 30;
/**
 * Phase centres in a 470 by 230 box: the pending phases left to right, the completed ones above
 * and below the claim, and `cancelled` below `queued`.
 */
const layout: Record<string, readonly [x: number, y: number]> = {
  queued: [56, 115],
  cancelled: [56, 200],
  claimed: [228, 115],
  accepted: [228, 30],
  rejected: [228, 200],
  retrying: [408, 40],
  acknowledged: [408, 115],
  held: [408, 190],
};

/** Where the segment from a node's centre towards `toward` leaves its rectangle. */
function exit([x, y]: readonly [number, number], [tx, ty]: readonly [number, number]) {
  const dx = tx - x;
  const dy = ty - y;
  const scale = Math.min(
    dx ? width / 2 / Math.abs(dx) : Infinity,
    dy ? height / 2 / Math.abs(dy) : Infinity,
  );
  return [x + dx * scale, y + dy * scale] as const;
}

export const phases: View = (element, data, links) => {
  const panel = h('div', { class: 'ov-detail', 'aria-live': 'polite' });
  const nodes = new Map<string, SVGGElement>();
  const known = data.phases.phases.filter((phase) => layout[phase.id]);
  const pairs = new Set(data.phases.transitions.map(([from, to]) => `${from}>${to}`));
  const edges = data.phases.transitions
    .filter(([from, to]) => layout[from] && layout[to])
    .map(([from, to, via]) => {
      const a = layout[from]!;
      const b = layout[to]!;
      // A pair with a reverse edge bows apart so both stay visible.
      const bow = pairs.has(`${to}>${from}`) ? 12 : 0;
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const control = [
        mx - ((b[1] - a[1]) / length) * bow,
        my + ((b[0] - a[0]) / length) * bow,
      ] as const;
      const start = exit(a, control);
      const end = exit(b, control);
      return s('path', {
        class: `ov-phase-edge is-${via}`,
        d: `M${start[0]},${start[1]} Q${control[0]},${control[1]} ${end[0]},${end[1]}`,
        'marker-end': 'url(#ov-phase-arrow)',
        'data-from': from,
        'data-to': to,
      });
    });
  const select = (id: string) => {
    const phase = data.phases.phases.find((entry) => entry.id === id)!;
    for (const [name, node] of nodes) node.classList.toggle('is-current', name === id);
    for (const edge of edges)
      edge.classList.toggle(
        'is-related',
        edge.getAttribute('data-from') === id || edge.getAttribute('data-to') === id,
      );
    const out = data.phases.transitions.filter(([from]) => from === id);
    const into = data.phases.transitions.filter(([, to]) => to === id);
    panel.replaceChildren(
      h('p', { class: 'ov-detail-title' }, h('code', {}, phase.id)),
      h(
        'p',
        {},
        phase.description.replace(/^./, (letter) => letter.toUpperCase()),
      ),
      h('p', { class: 'ov-label' }, 'Transitions'),
      h(
        'ul',
        {},
        into.map(([from, , via]) => h('li', {}, h('code', {}, from), ` to ${id} by ${via}`)),
        out.map(([, to, via]) => h('li', {}, `${id} to `, h('code', {}, to), ` by ${via}`)),
        !into.length && !out.length && h('li', {}, 'None'),
      ),
    );
  };
  const svg = s(
    'svg',
    {
      viewBox: '0 0 464 230',
      width: 464,
      height: 230,
      class: 'ov-phase-diagram',
      role: 'img',
      'aria-label': `Effect phases: ${known.map((phase) => phase.id).join(', ')}`,
    },
    s(
      'defs',
      {},
      s(
        'marker',
        {
          id: 'ov-phase-arrow',
          viewBox: '0 0 8 8',
          refX: 7,
          refY: 4,
          markerWidth: 7,
          markerHeight: 7,
          orient: 'auto-start-reverse',
        },
        s('path', { d: 'M0,0 L8,4 L0,8 z', class: 'ov-arrowhead' }),
      ),
    ),
    edges,
    known.map((phase) => {
      const [x, y] = layout[phase.id]!;
      const node = s(
        'g',
        { class: 'ov-node ov-phase', onclick: () => select(phase.id) },
        s('rect', { x: x - width / 2, y: y - height / 2, width, height, rx: 15 }),
        s('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'ov-node-title' }, phase.id),
      );
      nodes.set(phase.id, node);
      return node;
    }),
  );
  const kinds = [...new Set(data.phases.transitions.map(([, , via]) => via))];
  element.replaceChildren(
    h(
      'div',
      { class: 'ov-phases' },
      h(
        'p',
        { class: 'ov-legend' },
        kinds.flatMap((via) => [h('span', { class: `ov-key is-${via}` }), via]),
      ),
      h('div', { class: 'ov-path-body' }, h('div', { class: 'ov-scroll' }, svg), panel),
      h(
        'p',
        { class: 'ov-muted' },
        'Phases from ',
        link(links.source(data.phases.source), h('code', {}, data.phases.source)),
        '.',
      ),
    ),
  );
  select(known.some((phase) => phase.id === 'held') ? 'held' : known[0]!.id);
};
