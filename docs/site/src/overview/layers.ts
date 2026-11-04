/**
 * Every workspace in its layer, with its framework dependencies. Selecting a workspace marks
 * what it depends on and what depends on it, and draws those edges over the bands.
 */
import { h, inline, link, s, shortName, type Links, type Overview, type View } from './dom';

type Workspace = Overview['workspaces'][number];

function detail(
  workspace: Workspace,
  dependents: readonly Workspace[],
  byName: ReadonlyMap<string, Workspace>,
  links: Links,
  select: (name: string) => void,
) {
  const chips = (names: readonly string[]) =>
    names.length
      ? h(
          'p',
          { class: 'ov-chips' },
          names.map((name) =>
            h(
              'button',
              {
                type: 'button',
                class: 'ov-chip',
                'data-layer': byName.get(name)!.layer,
                onclick: () => select(name),
              },
              shortName(name),
            ),
          ),
        )
      : h('p', { class: 'ov-muted' }, 'None');
  return [
    h('p', { class: 'ov-detail-meta' }, workspace.directory),
    h('p', { class: 'ov-detail-title' }, h('code', {}, workspace.name)),
    workspace.lead && h('p', {}, ...inline(workspace.lead)),
    h('p', { class: 'ov-label' }, 'Depends on'),
    chips(workspace.dependsOn),
    h('p', { class: 'ov-label' }, 'Used by'),
    chips(dependents.map((entry) => entry.name)),
    workspace.primitives.length > 0 && h('p', { class: 'ov-label' }, 'Primitives'),
    workspace.primitives.length > 0 &&
      h(
        'p',
        { class: 'ov-inline-list' },
        workspace.primitives.map((primitive) =>
          link(links.doc(`primitives#${primitive.anchor}`), primitive.title),
        ),
      ),
    workspace.skills.length > 0 && h('p', { class: 'ov-label' }, 'Skills'),
    workspace.skills.length > 0 &&
      h(
        'p',
        { class: 'ov-inline-list' },
        workspace.skills.map((skill) => link(links.workspace(skill.directory), skill.name)),
      ),
    h('p', {}, link(links.workspace(workspace.directory), 'README')),
  ];
}

export const layers: View = (element, data, links) => {
  const byName = new Map(data.workspaces.map((workspace) => [workspace.name, workspace]));
  const chips = new Map<string, HTMLButtonElement>();
  const overlay = s('svg', { class: 'ov-overlay', 'aria-hidden': 'true' });
  const panel = h('div', { class: 'ov-detail', 'aria-live': 'polite' });
  let selected = byName.has('@tortoise/runtime') ? '@tortoise/runtime' : data.workspaces[0]!.name;

  const bands = data.layers.map((layer) => {
    const members = data.workspaces
      .filter((workspace) => workspace.layer === layer.directory)
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
    return h(
      'div',
      { class: 'ov-band', 'data-layer': layer.directory },
      h('p', { class: 'ov-band-title' }, layer.title, ' ', h('code', {}, `${layer.directory}/*`)),
      h(
        'div',
        { class: 'ov-chips' },
        members.map((workspace) => {
          const chip = h(
            'button',
            {
              type: 'button',
              class: 'ov-chip',
              'data-layer': workspace.layer,
              title: workspace.directory,
              onclick: () => select(workspace.name),
            },
            shortName(workspace.name),
          );
          chips.set(workspace.name, chip);
          return chip;
        }),
      ),
    );
  });
  const canvas = h('div', { class: 'ov-bands' }, overlay, bands);

  const draw = () => {
    const box = canvas.getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    overlay.setAttribute('width', String(box.width));
    overlay.setAttribute('height', String(box.height));
    const centre = (name: string) => {
      const rect = chips.get(name)!.getBoundingClientRect();
      return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
    };
    const from = centre(selected);
    const workspace = byName.get(selected)!;
    const edge = (name: string, kind: string) => {
      const to = centre(name);
      const bend = Math.max(24, Math.abs(to.y - from.y) / 2);
      const direction = to.y >= from.y ? 1 : -1;
      return s('path', {
        class: `ov-overlay-edge ${kind}`,
        d: `M${from.x},${from.y} C${from.x},${from.y + bend * direction} ${to.x},${to.y - bend * direction} ${to.x},${to.y}`,
      });
    };
    overlay.replaceChildren(
      ...workspace.dependsOn.map((name) => edge(name, 'is-dependency')),
      ...data.workspaces
        .filter((entry) => entry.dependsOn.includes(selected))
        .map((entry) => edge(entry.name, 'is-dependent')),
    );
  };

  function select(name: string) {
    selected = name;
    const workspace = byName.get(name)!;
    const dependents = data.workspaces.filter((entry) => entry.dependsOn.includes(name));
    for (const [chipName, chip] of chips) {
      chip.classList.toggle('is-selected', chipName === name);
      chip.classList.toggle('is-dependency', workspace.dependsOn.includes(chipName));
      chip.classList.toggle(
        'is-dependent',
        dependents.some((entry) => entry.name === chipName),
      );
      chip.setAttribute('aria-pressed', String(chipName === name));
    }
    panel.replaceChildren(
      ...(detail(workspace, dependents, byName, links, select).filter(Boolean) as Node[]),
    );
    draw();
  }

  element.replaceChildren(
    h(
      'div',
      { class: 'ov-layers' },
      h(
        'p',
        { class: 'ov-legend' },
        h('span', { class: 'ov-key is-dependency' }),
        'Depends on',
        h('span', { class: 'ov-key is-dependent' }),
        'Used by',
      ),
      h('div', { class: 'ov-layers-body' }, canvas, panel),
      h('p', { class: 'ov-label' }, 'Import rules'),
      h(
        'ul',
        { class: 'ov-rules' },
        data.boundary.rules.map((rule) => h('li', {}, rule)),
      ),
      h(
        'p',
        { class: 'ov-muted' },
        'Enforced by ',
        link(links.source(data.boundary.source), h('code', {}, data.boundary.source)),
        '.',
      ),
    ),
  );
  select(selected);
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return () => observer.disconnect();
};
