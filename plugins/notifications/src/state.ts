import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { JsonValue } from '@agent-native/contracts';

/** A reply a notification offers. Only the digest of its nonce is kept; the nonce went to the OS. */
export interface ReplyRecord {
  effectId: string;
  /** The notified principal: the only one whose reply counts. */
  principal: string;
  /** The notify action that showed it. */
  action: string;
  button: string;
  handler: string;
  operation: string;
  input: Record<string, JsonValue>;
  expiresAt: number;
}

/** The plugin's slice, under `state.notifications`. */
export interface NotificationsState {
  /** The local owner: the dispatcher acts as them, narrowed to issuing and completing. */
  owner: string;
  /** Live replies by the hex SHA-256 of their nonce. */
  replies: Record<string, ReplyRecord>;
}

export const createNotificationsState = (ownerId: string): NotificationsState => ({
  owner: ownerId,
  replies: {},
});

/** Hex SHA-256 of a nonce: how replies are stored and looked up. */
export const digestOf = (nonce: string) => bytesToHex(sha256(utf8ToBytes(nonce)));

/** A reply nonce: 32 random bytes, base64url, within the shell parser's identifier rule. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
