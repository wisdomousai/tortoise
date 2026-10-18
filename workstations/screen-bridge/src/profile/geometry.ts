import type { AccessibilityNode, Point, Region } from '../ports';

export function intersects(a: Region, b: Region): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
export function contains(region: Region, point: Point): boolean {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  );
}
export const center = (region: Region): Point => ({
  x: region.x + region.width / 2,
  y: region.y + region.height / 2,
});

/** Depth-first search for a node by role and accessible name. */
export function findNode(
  nodes: readonly AccessibilityNode[] | undefined,
  wanted: { readonly role: string; readonly name: string },
): AccessibilityNode | undefined {
  for (const node of nodes ?? []) {
    if (node.role === wanted.role && node.name === wanted.name) return node;
    const found = findNode(node.children, wanted);
    if (found) return found;
  }
  return undefined;
}
