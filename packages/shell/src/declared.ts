import type { CatalogOs, CatalogOsHandler } from '@agent-native/contracts';

/** The declared handlers of one kind, typed as that kind. */
export type Of<K extends CatalogOsHandler['kind']> = Extract<CatalogOsHandler, { kind: K }>;
export const of = <K extends CatalogOsHandler['kind']>(os: CatalogOs | undefined, kind: K) =>
  (os?.handlers ?? []).filter((handler): handler is Of<K> => handler.kind === kind);

/** What the share handlers accept together: one share target per application on every platform. */
export function shareAccepts(os: CatalogOs | undefined) {
  const shares = of(os, 'share');
  const mediaTypes = [...new Set(shares.flatMap((share) => share.accepts.mediaTypes ?? []))];
  return {
    any: shares.length > 0,
    text: shares.some((share) => share.accepts.text),
    url: shares.some((share) => share.accepts.url),
    mediaTypes,
  };
}
