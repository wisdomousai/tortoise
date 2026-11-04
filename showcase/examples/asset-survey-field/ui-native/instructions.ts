import type { z } from 'zod';
import type { survey } from '@tortoise/asset-survey/contracts/kinds';

/** A survey's instructions as the hub sent it: the kinds of capture wanted and the structure slice. */
export type SurveyInstructions = z.output<(typeof survey)['instructions']>;
export type InstructionsNode = SurveyInstructions['nodes'][number];
export type CaptureBody = z.output<(typeof survey)['report']>;

const compactKey = (text: string) => text.replace(/\s+/g, '').toUpperCase();
const byDesignation = (a: InstructionsNode, b: InstructionsNode) =>
  a.designation.localeCompare(b.designation);

/** The slice's nodes depth first, each with its depth. */
export function tree(nodes: readonly InstructionsNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | undefined, InstructionsNode[]>();
  for (const node of nodes) {
    // A root of the survey keeps no parent from outside the slice.
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  const walk = (
    node: InstructionsNode,
    depth: number,
  ): (InstructionsNode & { depth: number })[] => [
    { ...node, depth },
    ...(children.get(node.id) ?? []).sort(byDesignation).flatMap((child) => walk(child, depth + 1)),
  ];
  return (children.get(undefined) ?? []).sort(byDesignation).flatMap((root) => walk(root, 0));
}

/** Nodes whose designation starts with `q` (spaces and case ignored) or whose name contains it. */
export function matches(node: InstructionsNode, q: string) {
  const key = compactKey(q);
  const text = q.trim().toLowerCase();
  return (
    !text || compactKey(node.designation).startsWith(key) || node.name.toLowerCase().includes(text)
  );
}
