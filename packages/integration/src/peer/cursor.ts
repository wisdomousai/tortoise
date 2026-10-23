import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ApplicationError, canonicalJson, type JsonValue } from '@agent-native/contracts';

/** Equal strings, compared without stopping at the first difference. */
function same(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/**
 * Page cursors a peer source hands out. Each wraps the peer's own cursor with an HMAC over the
 * local operation, the query without its cursor and the principal that read it, so a cursor
 * never pages another query or reaches another person. The key lives in memory: a restart
 * invalidates cursors, and a reader starts again from the first page.
 */
export function createCursorSeal(key: Uint8Array = crypto.getRandomValues(new Uint8Array(32))) {
  const mac = (operation: string, query: JsonValue, principalId: string, cursor: string) =>
    bytesToHex(
      hmac(sha256, key, utf8ToBytes(canonicalJson([operation, query, principalId, cursor]))),
    );
  return {
    seal(operation: string, query: JsonValue, principalId: string, cursor: string): string {
      const sealed = `${bytesToHex(utf8ToBytes(cursor))}.${mac(operation, query, principalId, cursor)}`;
      if (sealed.length > 512)
        throw new ApplicationError(
          'UNAVAILABLE',
          'The peer answered a page cursor that is too long',
        );
      return sealed;
    },
    open(operation: string, query: JsonValue, principalId: string, sealed: string): string {
      const [encoded = '', tag = ''] = sealed.split('.');
      let cursor = '';
      try {
        cursor = new TextDecoder().decode(hexToBytes(encoded));
      } catch {}
      if (!same(tag, mac(operation, query, principalId, cursor)))
        throw new ApplicationError('INVALID_INPUT', 'The page cursor is not valid for this query');
      return cursor;
    },
  };
}
export type CursorSeal = ReturnType<typeof createCursorSeal>;
