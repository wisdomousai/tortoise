import type { ComputerUseDriver } from './ports';
import { center, findNode } from './profile';

/**
 * Deterministic driver for CI and for stations whose targets are all addressable: resolves
 * accessibility locators and fixed regions, and refuses natural-language targets. Live
 * computer-use drivers (cloud or local models) implement the same port and are subject to the
 * same controller gate; they only add `describe` targets.
 */
export function createScriptedDriver(): ComputerUseDriver {
  return {
    id: 'scripted',
    async resolveTarget(frame, target) {
      if ('region' in target) return center(target.region);
      if ('locator' in target) {
        const node = findNode(frame.accessibility, target.locator);
        return node?.box ? center(node.box) : undefined;
      }
      return undefined;
    },
  };
}
