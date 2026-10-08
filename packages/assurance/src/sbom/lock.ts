import { createHash } from 'node:crypto';

/** A `bun.lock` package entry: `[ident, resolved, meta, integrity]`; workspaces have only ident. */
export type LockEntry = [string, string?, LockMeta?, string?];
interface LockMeta {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}
export interface BunLock {
  readonly workspaces: Record<
    string,
    {
      readonly name?: string;
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  >;
  readonly packages: Record<string, LockEntry>;
}

/** `bun.lock` is JSON with trailing commas. Strings in it never contain `,}` or `,]`. */
export function parseBunLock(text: string): BunLock {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as BunLock;
}

export const purl = (name: string, version: string) =>
  `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${encodeURIComponent(version)}`;
/** `name@version`, where the name itself may start with `@`. */
export function splitIdent(ident: string): { name: string; version: string } {
  const at = ident.lastIndexOf('@');
  return { name: ident.slice(0, at), version: ident.slice(at + 1) };
}
export function hashOf(integrity: string | undefined) {
  const match = integrity && /^sha(512|384|256|1)-(.+)$/.exec(integrity);
  if (!match) return undefined;
  return {
    alg: match[1] === '1' ? 'SHA-1' : `SHA-${match[1]}`,
    content: Buffer.from(match[2]!, 'base64').toString('hex'),
  };
}
/** RFC 4122 shaped UUID derived from content, so the same lock yields the same serial number. */
export function stableUuid(text: string) {
  const hex = createHash('sha256').update(text).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
