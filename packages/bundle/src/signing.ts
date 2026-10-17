import { canonicalJson } from '@agent-native/contracts';

/** A public key a site trusts, by the ID signatures name. */
export interface TrustedKey {
  readonly keyId: string;
  /** Raw Ed25519 public key, base64. */
  readonly publicKey: string;
}
/** A signing key. Kept by the publisher, never in a repository or a bundle. */
export interface SigningKey extends TrustedKey {
  /** PKCS #8 Ed25519 private key, base64. */
  readonly privateKey: string;
}
/** `bundle.sig`: which key signed, and the Ed25519 signature over the canonical manifest. */
export interface BundleSignature {
  readonly keyId: string;
  readonly signature: string;
}

const base64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64');
const bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, 'base64'));

async function keyIdOf(publicKey: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey));
  return Buffer.from(hash.slice(0, 8)).toString('hex');
}

/** A fresh Ed25519 key pair; its ID is the first 8 bytes of the public key's SHA-256. */
export async function generateSigningKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKey = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return {
    keyId: await keyIdOf(publicKey),
    publicKey: base64(publicKey),
    privateKey: base64(privateKey),
  };
}

const message = (manifest: unknown) => new TextEncoder().encode(canonicalJson(manifest));

/** Sign the canonical JSON of `manifest`. */
export async function signManifest(manifest: unknown, key: SigningKey): Promise<BundleSignature> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    bytesOf(key.privateKey),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('Ed25519', privateKey, message(manifest));
  return { keyId: key.keyId, signature: base64(signature) };
}

/**
 * Whether `signature` is a valid signature of `manifest` by one of `trusted`. The key is chosen
 * by ID and its ID is recomputed from the key bytes, so a listing cannot pair one ID with
 * another key.
 */
export async function verifyManifestSignature(
  manifest: unknown,
  signature: BundleSignature,
  trusted: readonly TrustedKey[],
): Promise<boolean> {
  const key = trusted.find((candidate) => candidate.keyId === signature.keyId);
  if (!key) return false;
  const raw = bytesOf(key.publicKey);
  if ((await keyIdOf(raw)) !== key.keyId) return false;
  const publicKey = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, [
    'verify',
  ]);
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    bytesOf(signature.signature),
    message(manifest),
  );
}
