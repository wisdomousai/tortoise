/** The overview views by name, as `<OverviewView view="...">` names them in `docs/overview.md`. */
import type { Links, Overview, View } from './dom';
import { examples } from './examples';
import { layers } from './layers';
import { phases } from './phases';
import { ports } from './ports';
import { properties } from './properties';
import { requestPath } from './request-path';
import './overview.css';

export const views = {
  'request-path': requestPath,
  phases,
  properties,
  layers,
  ports,
  examples,
} satisfies Record<string, View>;

export type ViewName = keyof typeof views;
export type { Links, Overview };

/** Render one view into `element`; the returned function removes its listeners. */
export function mount(name: ViewName, element: HTMLElement, data: Overview, links: Links) {
  return views[name](element, data, links) ?? (() => undefined);
}
