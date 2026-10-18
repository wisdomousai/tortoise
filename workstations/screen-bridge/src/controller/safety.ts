import type { BridgeControl } from '../controller';
import type { Frame, Point } from '../ports';
import { contains, findNode, type Procedure, type StationProfile } from '../profile';

/** Why the bridge state forbids running `procedure` now, or undefined when it may run. */
export function blockedBy(control: BridgeControl, procedure: Procedure): string | undefined {
  if (control.seat === 'operator') return 'The operator has the station';
  if (control.mode === 'monitor-only') return 'The bridge is in monitor-only mode';
  if (control.mode === 'assist' && procedure.hazard !== 'none')
    return `The bridge is in assist mode; ${procedure.title} needs actuate mode`;
  return undefined;
}

/** The forbidden zone containing `point` on `frame`, by fixed region or located node. */
export function forbiddenAt(
  profile: StationProfile,
  frame: Frame,
  point: Point,
): string | undefined {
  for (const zone of profile.forbidden) {
    if (zone.region && contains(zone.region, point)) return zone.id;
    const node = zone.locator ? findNode(frame.accessibility, zone.locator) : undefined;
    if (node?.box && contains(node.box, point)) return zone.id;
  }
  return undefined;
}
