import {
  hmiTarget,
  openAttention,
  type AttentionItem,
  type FieldDeclaration,
  type FieldValue,
  type Station,
} from '../domain';
import { byCodePoint, compact, type Context } from './context';

/** The declared type, or one inferred from the proposed value when the bridge sent none. */
export function declaration(item: AttentionItem): FieldDeclaration {
  if (item.declared) return item.declared;
  const type = typeof item.proposed;
  return { type: type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'text' };
}
/** A correction must match the field's declared type; a blank or wrong-typed value is refused. */
export function acceptsValue(declared: FieldDeclaration, value: FieldValue) {
  switch (declared.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (declared.options ?? []).includes(value);
    case 'text':
      return typeof value === 'string' && value.trim() !== '';
  }
}
/** Unsure readings and held screen procedures: everything that waits for a person. */
export function attentionItems(ctx: Context, station: Station) {
  const readings = openAttention(ctx.state, station.id)
    .sort((a, b) => a.createdAt - b.createdAt || byCodePoint(a.id, b.id))
    .map((item) =>
      compact({
        id: item.id,
        station: item.station,
        kind: 'reading' as const,
        title: `Check ${item.field}`,
        detail: `The station screen was read as ${JSON.stringify(item.proposed)} with ${Math.round(item.confidence * 100)}% confidence.`,
        field: item.field,
        proposed: item.proposed,
        value: declaration(item),
        confidence: item.confidence,
        source: item.source,
        frameDigest: item.frameDigest,
        profile: item.profile,
        createdAt: item.createdAt,
      }),
    );
  const held = ctx.effects({ target: hmiTarget(station.id), held: true }).map((effect) =>
    compact({
      id: `reconcile:${effect.id}`,
      station: station.id,
      kind: 'reconcile' as const,
      title: `Check the station: was ${String((effect.payload as { recipe?: string }).recipe ?? effect.type)} loaded?`,
      detail: effect.holdReason,
      effectId: effect.id,
      createdAt: effect.heldAt ?? effect.createdAt,
    }),
  );
  return [...held, ...readings];
}
