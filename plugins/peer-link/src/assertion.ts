import { z } from 'zod';

/**
 * The signed subject assertion a call on behalf of a person carries in `Tortoise-Subject`:
 * `v1.<claims>.<signature>`, where `claims` is base64url JSON and `signature` is the base64url
 * Ed25519 signature, by the calling application's enrolled key, over the ASCII `v1.<claims>`.
 *
 * The claims bind the assertion to one callee (`aud`), one person (`sub`), one request line and
 * body, and two minutes at most; `jti` makes it single-use.
 */
export const assertionVersion = 'v1';
/** The longest an assertion may live, in seconds. */
export const assertionLifetime = 120;
/** How far ahead of the callee's clock `iat` may be, in seconds. */
export const assertionSkew = 30;
/** The largest request body an assertion may cover; larger calls are refused. */
export const assertionBodyLimit = 1024 * 1024;

export const subjectClaimsSchema = z.strictObject({
  /** The audience the callee issued this peer at enrollment. */
  aud: z.string().min(1).max(200),
  /** The caller's own principal ID for the person. */
  sub: z.string().min(1).max(200),
  /** Whether a person or a delegated run (an agent or a job) made the call on the caller. */
  act: z.enum(['person', 'agent']),
  /** `<METHOD> <path and query>` of the request. */
  req: z.string().min(1).max(2048),
  /** Hex SHA-256 of the request body; of the empty string when there is none. */
  body: z.string().regex(/^[0-9a-f]{64}$/),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});
export type SubjectClaims = z.infer<typeof subjectClaimsSchema>;

const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, 'base64url'));

/** Hex SHA-256 of a request body. */
export async function bodyDigest(body: Uint8Array | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', body as ArrayBuffer);
  return Buffer.from(hash).toString('hex');
}

/** What `req` holds for a request: its method and its path with the query. */
export function requestLine(method: string, url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return `${method.toUpperCase()} ${parsed.pathname}${parsed.search}`;
}

/** An Ed25519 key pair for signing assertions: raw public key and PKCS #8 private key, base64url. */
export interface AssertionKey {
  readonly publicKey: string;
  readonly privateKey: string;
}

export async function generateAssertionKey(): Promise<AssertionKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return {
    publicKey: base64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: base64url(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
}

/** Sign claims with the PKCS #8 private key; the header value. */
export async function signSubjectAssertion(
  privateKey: string,
  claims: SubjectClaims,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    bytesOf(privateKey),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signed = `${assertionVersion}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign('Ed25519', key, encoder.encode(signed));
  return `${signed}.${base64url(signature)}`;
}

/**
 * The claims of a header value whose signature verifies with the raw public key, or undefined
 * for a malformed value or a signature that does not verify. Claims are parsed only after the
 * signature holds, so nothing unsigned is read.
 */
export async function verifySubjectAssertion(
  header: string,
  publicKey: string,
): Promise<SubjectClaims | undefined> {
  const parts = header.split('.');
  if (parts.length !== 3 || parts[0] !== assertionVersion) return undefined;
  const [, claims, signature] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(claims) || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return undefined;
  const key = await crypto.subtle.importKey('raw', bytesOf(publicKey), { name: 'Ed25519' }, false, [
    'verify',
  ]);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    key,
    bytesOf(signature),
    encoder.encode(`${assertionVersion}.${claims}`),
  );
  if (!valid) return undefined;
  try {
    const parsed = subjectClaimsSchema.safeParse(
      JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
