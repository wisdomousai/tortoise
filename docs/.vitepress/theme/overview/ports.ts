/**
 * The kernel's ports with their defaults and providers, then every host plugin with what it
 * requires, where it runs and which examples compose it.
 */
import { h, link, shortName, table, type Links, type Overview, type View } from './dom';

function pluginLink(data: Overview, id: string, links: Links) {
  const plugin = data.plugins.find((entry) => entry.kind === 'host-plugin' && entry.id === id);
  return plugin ? link(links.workspace(plugin.directory), h('code', {}, id)) : h('code', {}, id);
}

const list = (items: readonly Node[]) =>
  items.length
    ? h('span', { class: 'ov-inline-list' }, items)
    : h('span', { class: 'ov-muted' }, 'None');

export const ports: View = (element, data, links) => {
  const composedBy = (id: string) =>
    data.examples.filter((example) => example.plugins.includes(id)).map((example) => example.id);
  const usedBy = (name: string) =>
    data.workspaces.filter((workspace) => workspace.dependsOn.includes(name));
  const hostPlugins = data.plugins.flatMap((plugin) =>
    plugin.kind === 'host-plugin' ? [plugin] : [],
  );
  const libraries = data.plugins.filter((plugin) => plugin.kind === 'library');
  element.replaceChildren(
    h(
      'div',
      { class: 'ov-ports' },
      table(
        '',
        ['Port', 'Without a plugin', 'Provided by'],
        data.ports.map((port) => [
          port.title,
          port.fallback,
          list(port.providers.map((provider) => pluginLink(data, provider.plugin, links))),
        ]),
      ),
      h('p', { class: 'ov-label' }, 'Host plugins'),
      table(
        '',
        ['Plugin', 'Requires', 'Runs on', 'Composed by'],
        hostPlugins.map((plugin) => [
          [
            pluginLink(data, plugin.id, links),
            h('br'),
            h('span', { class: 'ov-muted' }, plugin.title),
          ],
          list(plugin.requires.map((id) => pluginLink(data, id, links))),
          plugin.platforms.join(', '),
          list(composedBy(plugin.id).map((id) => link(links.workspace(`examples/${id}`), id))),
        ]),
      ),
      h('p', { class: 'ov-label' }, 'Connector packages'),
      table(
        '',
        ['Package', 'Used by'],
        libraries.map((library) => [
          link(links.workspace(library.directory), h('code', {}, shortName(library.name))),
          list(
            usedBy(library.name).map((workspace) =>
              link(links.workspace(workspace.directory), shortName(workspace.name)),
            ),
          ),
        ]),
      ),
    ),
  );
};
