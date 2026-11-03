/**
 * The request paths as a step-through diagram: one column per part of the system, one row per step. The arrow
 * keys and the buttons move through the steps; the panel below names the code and the tests.
 */
import {
  h,
  inline,
  link,
  s,
  segmented,
  testList,
  type Links,
  type Overview,
  type View,
} from './dom';

const columnWidth = 128;
const nodeWidth = 112;
const nodeHeight = 40;
const row = 56;
const header = 36;

type Path = Overview['paths'][number];

function diagram(data: Overview, path: Path, current: number, select: (index: number) => void) {
  const columns = data.columns;
  const width = columns.length * columnWidth;
  const height = header + path.steps.length * row;
  const columnIndex = (column: string) => columns.findIndex((entry) => entry.id === column);
  const at = (index: number) => {
    const step = path.steps[index]!;
    return {
      x: columnIndex(step.column) * columnWidth + (columnWidth - nodeWidth) / 2,
      y: header + index * row + 4,
    };
  };
  const svg = s(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      class: 'ov-path-diagram',
      role: 'img',
      'aria-label': `${path.title}: ${path.steps.map((step) => step.title).join(', then ')}`,
    },
    s(
      'defs',
      {},
      s(
        'marker',
        {
          id: `ov-arrow-${path.id}`,
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
    columns.map((column, index) =>
      s(
        'g',
        {},
        s('rect', {
          x: index * columnWidth + 2,
          y: 0,
          width: columnWidth - 4,
          height,
          rx: 6,
          class: 'ov-column',
        }),
        s(
          'text',
          {
            x: index * columnWidth + columnWidth / 2,
            y: 22,
            class: 'ov-column-title',
            'text-anchor': 'middle',
          },
          column.title,
        ),
      ),
    ),
    path.steps.slice(1).map((_, index) => {
      const from = at(index);
      const to = at(index + 1);
      const x1 = from.x + nodeWidth / 2;
      const y1 = from.y + nodeHeight;
      const x2 = to.x + nodeWidth / 2;
      const y2 = to.y;
      return s('path', {
        d: `M${x1},${y1} C${x1},${y1 + 10} ${x2},${y2 - 10} ${x2},${y2 - 1}`,
        class: `ov-edge${index < current ? ' is-done' : ''}`,
        'marker-end': `url(#ov-arrow-${path.id})`,
      });
    }),
    path.steps.map((step, index) => {
      const { x, y } = at(index);
      const state = index === current ? ' is-current' : index < current ? ' is-done' : '';
      return s(
        'g',
        {
          class: `ov-node${state}`,
          onclick: () => select(index),
        },
        s('rect', { x, y, width: nodeWidth, height: nodeHeight, rx: 6 }),
        s('text', { x: x + 10, y: y + 25, class: 'ov-node-index' }, String(index + 1)),
        s('text', { x: x + 26, y: y + 25, class: 'ov-node-title' }, step.title),
      );
    }),
  );
  return h('div', { class: 'ov-scroll' }, svg);
}

function detail(data: Overview, path: Path, index: number, links: Links) {
  const step = path.steps[index]!;
  const column = data.columns.find((entry) => entry.id === step.column)!;
  return [
    h(
      'p',
      { class: 'ov-detail-meta' },
      `Step ${index + 1} of ${path.steps.length} · ${column.title}`,
    ),
    h('p', { class: 'ov-detail-title' }, step.title),
    h('p', {}, ...inline(step.summary)),
    h('p', { class: 'ov-label' }, 'Tests'),
    testList(step.tests, links),
    h('p', { class: 'ov-label' }, 'Code'),
    h(
      'p',
      { class: 'ov-sources' },
      step.sources.map((source) => link(links.source(source), h('code', {}, source))),
    ),
    h('p', {}, 'Guide: ', link(links.doc(step.doc), data.docs[step.doc] ?? step.doc)),
  ];
}

export const requestPath: View = (element, data, links) => {
  let path = data.paths[0]!;
  let current = 0;
  const stage = h('div', { class: 'ov-path-stage' });
  const panel = h('div', { class: 'ov-detail', 'aria-live': 'polite' });
  const counter = h('span', { class: 'ov-counter' });
  const previous = h(
    'button',
    { type: 'button', class: 'ov-button', onclick: () => select(current - 1) },
    'Previous',
  );
  const next = h(
    'button',
    { type: 'button', class: 'ov-button', onclick: () => select(current + 1) },
    'Next',
  );
  const render = () => {
    const scroller = diagram(data, path, current, select);
    stage.replaceChildren(scroller);
    // On a narrow screen the diagram scrolls; keep the current step in view.
    const node = scroller.querySelector('.is-current');
    if (node) {
      const box = node.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      scroller.scrollLeft += box.left + box.width / 2 - (frame.left + frame.width / 2);
    }
    panel.replaceChildren(...detail(data, path, current, links));
    counter.textContent = `${current + 1} / ${path.steps.length}`;
    previous.toggleAttribute('disabled', current === 0);
    next.toggleAttribute('disabled', current === path.steps.length - 1);
  };
  function select(index: number) {
    current = Math.max(0, Math.min(path.steps.length - 1, index));
    render();
  }
  const root = h(
    'div',
    {
      class: 'ov-path',
      tabindex: 0,
      'aria-label': 'Request path. Use the arrow keys to move between steps.',
      onkeydown: (event: Event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'ArrowDown' || key === 'ArrowRight') select(current + 1);
        else if (key === 'ArrowUp' || key === 'ArrowLeft') select(current - 1);
        else return;
        event.preventDefault();
      },
    },
    h(
      'div',
      { class: 'ov-toolbar' },
      segmented('Path', data.paths, path.id, (id) => {
        path = data.paths.find((entry) => entry.id === id)!;
        select(0);
      }),
      h('div', { class: 'ov-stepper' }, previous, counter, next),
    ),
    h('div', { class: 'ov-path-body' }, stage, panel),
  );
  render();
  element.replaceChildren(root);
};
